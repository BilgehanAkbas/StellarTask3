#![no_std]
#![allow(deprecated)]

use escrow_common::{EscrowClient, EscrowData, EscrowError, EscrowStatus};
use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, BytesN, Env, Vec};

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    EscrowWasmHash,
    EscrowCount,
    EscrowList,
}

#[contract]
pub struct Factory;

#[contractimpl]
impl Factory {
    /// Sets up the factory with an admin and the Wasm hash of the Escrow
    /// contract to deploy for every new agreement (uploaded once via
    /// `stellar contract upload` — see README.md).
    pub fn __constructor(env: Env, admin: Address, escrow_wasm_hash: BytesN<32>) {
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::EscrowWasmHash, &escrow_wasm_hash);
        env.storage().instance().set(&DataKey::EscrowCount, &0u32);
        env.storage().instance().set(&DataKey::EscrowList, &Vec::<Address>::new(&env));
    }

    /// Admin-only: rotate the Escrow Wasm used for future deployments.
    pub fn update_wasm_hash(env: Env, new_hash: BytesN<32>) -> Result<(), EscrowError> {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).ok_or(EscrowError::NotInitialized)?;
        admin.require_auth();
        env.storage().instance().set(&DataKey::EscrowWasmHash, &new_hash);
        Ok(())
    }

    /// Deploys a brand-new, independent Escrow instance (Factory pattern),
    /// then immediately performs a cross-contract call into it to confirm
    /// it initialized in the expected `Pending` state.
    pub fn create_escrow(
        env: Env,
        buyer: Address,
        seller: Address,
        arbiter: Address,
        token: Address,
        amount: i128,
        deadline_ledger: u32,
    ) -> Result<Address, EscrowError> {
        buyer.require_auth();

        let wasm_hash: BytesN<32> = env
            .storage()
            .instance()
            .get(&DataKey::EscrowWasmHash)
            .ok_or(EscrowError::WasmHashNotSet)?;

        let mut count: u32 = env.storage().instance().get(&DataKey::EscrowCount).unwrap_or(0);

        let mut salt_bytes = [0u8; 32];
        salt_bytes[28..32].copy_from_slice(&count.to_be_bytes());
        let salt = BytesN::from_array(&env, &salt_bytes);

        let constructor_args = (&buyer, &seller, &arbiter, &token, &amount, &deadline_ledger);
        let escrow_address = env.deployer().with_current_contract(salt).deploy_v2(wasm_hash, constructor_args);

        // Cross-contract call: verify the freshly deployed Escrow is live
        // and in the expected initial state via its generated client.
        let status = EscrowClient::new(&env, &escrow_address).get_status();
        if status != EscrowStatus::Pending {
            return Err(EscrowError::InvalidAmount);
        }

        count += 1;
        env.storage().instance().set(&DataKey::EscrowCount, &count);

        let mut list: Vec<Address> = env.storage().instance().get(&DataKey::EscrowList).unwrap_or_else(|| Vec::new(&env));
        list.push_back(escrow_address.clone());
        env.storage().instance().set(&DataKey::EscrowList, &list);

        env.events().publish((symbol_short!("esc_new"), buyer), escrow_address.clone());
        Ok(escrow_address)
    }

    /// Cross-contract call: reads the live status of a deployed escrow.
    pub fn get_escrow_status(env: Env, escrow_address: Address) -> EscrowStatus {
        EscrowClient::new(&env, &escrow_address).get_status()
    }

    /// Cross-contract call: reads the full details of a deployed escrow.
    pub fn get_escrow_details(env: Env, escrow_address: Address) -> EscrowData {
        EscrowClient::new(&env, &escrow_address).get_details()
    }

    pub fn get_all_escrows(env: Env) -> Vec<Address> {
        env.storage().instance().get(&DataKey::EscrowList).unwrap_or_else(|| Vec::new(&env))
    }

    pub fn get_escrow_count(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::EscrowCount).unwrap_or(0)
    }
}

#[cfg(test)]
mod test {
    extern crate std;

    use super::*;
    use soroban_sdk::testutils::Address as _;

    // Build the Escrow contract first: `stellar contract build -p escrow`
    // (see README.md). This import only affects `cargo test`.
    mod escrow_wasm {
        soroban_sdk::contractimport!(file = "../../target/wasm32v1-none/release/escrow.wasm");
    }

    fn setup(env: &Env) -> (FactoryClient<'_>, Address, BytesN<32>) {
        env.mock_all_auths();
        let admin = Address::generate(env);
        let wasm_hash = env.deployer().upload_contract_wasm(escrow_wasm::WASM);
        let factory_id = env.register(Factory, (&admin, &wasm_hash));
        (FactoryClient::new(env, &factory_id), admin, wasm_hash)
    }

    fn create_token<'a>(env: &Env, admin: &Address) -> (Address, soroban_sdk::token::StellarAssetClient<'a>) {
        let sac = env.register_stellar_asset_contract_v2(admin.clone());
        let address = sac.address();
        (address.clone(), soroban_sdk::token::StellarAssetClient::new(env, &address))
    }

    #[test]
    fn test_create_escrow_deploys_and_registers() {
        let env = Env::default();
        let (factory, _admin, _hash) = setup(&env);

        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let arbiter = Address::generate(&env);
        let (token, sac) = create_token(&env, &Address::generate(&env));
        sac.mint(&buyer, &1_000_000i128);

        let amount: i128 = 250_000;
        let deadline: u32 = env.ledger().sequence() + 500;
        let escrow_address = factory.create_escrow(&buyer, &seller, &arbiter, &token, &amount, &deadline);

        assert_eq!(factory.get_escrow_count(), 1);
        assert_eq!(factory.get_all_escrows(), soroban_sdk::vec![&env, escrow_address.clone()]);
        assert_eq!(factory.get_escrow_status(&escrow_address), EscrowStatus::Pending);
    }

    #[test]
    fn test_cross_contract_status_updates_after_funding() {
        let env = Env::default();
        let (factory, _admin, _hash) = setup(&env);

        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let arbiter = Address::generate(&env);
        let (token, sac) = create_token(&env, &Address::generate(&env));
        sac.mint(&buyer, &1_000_000i128);

        let amount: i128 = 250_000;
        let deadline: u32 = env.ledger().sequence() + 500;
        let escrow_address = factory.create_escrow(&buyer, &seller, &arbiter, &token, &amount, &deadline);

        let escrow_client = escrow_wasm::Client::new(&env, &escrow_address);
        escrow_client.fund();

        // Factory reads the live status through its own cross-contract call.
        assert_eq!(factory.get_escrow_status(&escrow_address), EscrowStatus::Funded);
    }

    #[test]
    fn test_multiple_escrows_get_unique_addresses() {
        let env = Env::default();
        let (factory, _admin, _hash) = setup(&env);

        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let arbiter = Address::generate(&env);
        let (token, sac) = create_token(&env, &Address::generate(&env));
        sac.mint(&buyer, &1_000_000i128);

        let amount: i128 = 100_000;
        let deadline: u32 = env.ledger().sequence() + 500;

        let e1 = factory.create_escrow(&buyer, &seller, &arbiter, &token, &amount, &deadline);
        let e2 = factory.create_escrow(&buyer, &seller, &arbiter, &token, &amount, &deadline);

        assert_ne!(e1, e2);
        assert_eq!(factory.get_escrow_count(), 2);
    }

    #[test]
    fn test_admin_can_update_wasm_hash() {
        let env = Env::default();
        let (factory, _admin, hash) = setup(&env);
        factory.update_wasm_hash(&hash);
    }
}