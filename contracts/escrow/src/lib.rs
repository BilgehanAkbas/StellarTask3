#![no_std]
#![allow(deprecated)]

use escrow_common::{EscrowData, EscrowError, EscrowStatus};
use soroban_sdk::{contract, contractimpl, contracttype, panic_with_error, symbol_short, token, Address, Env};

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Data,
}

const DAY_IN_LEDGERS: u32 = 17280;
const BUMP_AMOUNT: u32 = 30 * DAY_IN_LEDGERS;
const LIFETIME_THRESHOLD: u32 = BUMP_AMOUNT - DAY_IN_LEDGERS;

#[contract]
pub struct Escrow;

#[contractimpl]
impl Escrow {
    /// Initializes one escrow agreement. Called automatically at deploy
    /// time — directly, or by the Factory contract via `deploy_v2`.
    pub fn __constructor(
        env: Env,
        buyer: Address,
        seller: Address,
        arbiter: Address,
        token: Address,
        amount: i128,
        deadline_ledger: u32,
    ) {
        if amount <= 0 {
            panic_with_error!(&env, EscrowError::InvalidAmount);
        }
        if buyer == seller {
            panic_with_error!(&env, EscrowError::InvalidParties);
        }
        if deadline_ledger <= env.ledger().sequence() {
            panic_with_error!(&env, EscrowError::DeadlineAlreadyPassed);
        }

        let data = EscrowData {
            buyer: buyer.clone(),
            seller,
            arbiter,
            token,
            amount,
            deadline_ledger,
            status: EscrowStatus::Pending,
        };
        env.storage().instance().set(&DataKey::Data, &data);
        env.storage().instance().extend_ttl(LIFETIME_THRESHOLD, BUMP_AMOUNT);

        env.events().publish((symbol_short!("created"), buyer), amount);
    }

    /// Buyer locks the agreed `amount` of `token` into the contract.
    pub fn fund(env: Env) -> Result<(), EscrowError> {
        let mut data = Self::load(&env)?;
        if data.status != EscrowStatus::Pending {
            return Err(EscrowError::NotPending);
        }
        data.buyer.require_auth();

        token::Client::new(&env, &data.token).transfer(
            &data.buyer,
            &env.current_contract_address(),
            &data.amount,
        );

        data.status = EscrowStatus::Funded;
        Self::save(&env, &data);
        env.events().publish((symbol_short!("funded"), data.buyer.clone()), data.amount);
        Ok(())
    }

    /// Buyer confirms delivery and releases the funds to the seller.
    pub fn release(env: Env) -> Result<(), EscrowError> {
        let mut data = Self::load(&env)?;
        if data.status != EscrowStatus::Funded {
            return Err(EscrowError::NotFunded);
        }
        data.buyer.require_auth();

        Self::payout(&env, &data, &data.seller);
        data.status = EscrowStatus::Released;
        Self::save(&env, &data);
        env.events().publish((symbol_short!("released"), data.seller.clone()), data.amount);
        Ok(())
    }

    /// Seller voluntarily returns the funds to the buyer, canceling the deal.
    pub fn refund(env: Env) -> Result<(), EscrowError> {
        let mut data = Self::load(&env)?;
        if data.status != EscrowStatus::Funded {
            return Err(EscrowError::NotFunded);
        }
        data.seller.require_auth();

        Self::payout(&env, &data, &data.buyer);
        data.status = EscrowStatus::Refunded;
        Self::save(&env, &data);
        env.events().publish((symbol_short!("refunded"), data.buyer.clone()), data.amount);
        Ok(())
    }

    /// Buyer reclaims funds once the deadline has passed without a release.
    pub fn claim_timeout_refund(env: Env) -> Result<(), EscrowError> {
        let mut data = Self::load(&env)?;
        if data.status != EscrowStatus::Funded {
            return Err(EscrowError::NotFunded);
        }
        if env.ledger().sequence() < data.deadline_ledger {
            return Err(EscrowError::DeadlineNotReached);
        }
        data.buyer.require_auth();

        Self::payout(&env, &data, &data.buyer);
        data.status = EscrowStatus::Refunded;
        Self::save(&env, &data);
        env.events().publish((symbol_short!("timeout"), data.buyer.clone()), data.amount);
        Ok(())
    }

    /// Buyer or seller escalates a funded escrow into arbitration.
    pub fn open_dispute(env: Env, initiator: Address) -> Result<(), EscrowError> {
        let mut data = Self::load(&env)?;
        if data.status != EscrowStatus::Funded {
            return Err(EscrowError::NotFunded);
        }
        if initiator != data.buyer && initiator != data.seller {
            return Err(EscrowError::Unauthorized);
        }
        initiator.require_auth();

        data.status = EscrowStatus::Disputed;
        Self::save(&env, &data);
        env.events().publish((symbol_short!("disputed"), initiator), data.amount);
        Ok(())
    }

    /// Arbiter resolves a disputed escrow in favor of buyer or seller.
    pub fn resolve_dispute(env: Env, release_to_seller: bool) -> Result<(), EscrowError> {
        let mut data = Self::load(&env)?;
        if data.status != EscrowStatus::Disputed {
            return Err(EscrowError::NotDisputed);
        }
        data.arbiter.require_auth();

        let recipient = if release_to_seller { data.seller.clone() } else { data.buyer.clone() };
        Self::payout(&env, &data, &recipient);
        data.status = if release_to_seller { EscrowStatus::Released } else { EscrowStatus::Refunded };
        Self::save(&env, &data);
        env.events().publish((symbol_short!("resolved"), recipient), data.amount);
        Ok(())
    }

    /// Either party cancels the agreement before it has been funded.
    pub fn cancel(env: Env, initiator: Address) -> Result<(), EscrowError> {
        let mut data = Self::load(&env)?;
        if data.status != EscrowStatus::Pending {
            return Err(EscrowError::NotPending);
        }
        if initiator != data.buyer && initiator != data.seller {
            return Err(EscrowError::Unauthorized);
        }
        initiator.require_auth();

        data.status = EscrowStatus::Cancelled;
        Self::save(&env, &data);
        env.events().publish((symbol_short!("cancelled"), initiator), data.amount);
        Ok(())
    }

    /// Cross-contract-friendly view: current status only.
    pub fn get_status(env: Env) -> EscrowStatus {
        match Self::load(&env) {
            Ok(d) => d.status,
            Err(e) => panic_with_error!(&env, e),
        }
    }

    /// Cross-contract-friendly view: full agreement details.
    pub fn get_details(env: Env) -> EscrowData {
        match Self::load(&env) {
            Ok(d) => d,
            Err(e) => panic_with_error!(&env, e),
        }
    }

    fn load(env: &Env) -> Result<EscrowData, EscrowError> {
        env.storage().instance().get(&DataKey::Data).ok_or(EscrowError::NotInitialized)
    }

    fn save(env: &Env, data: &EscrowData) {
        env.storage().instance().set(&DataKey::Data, data);
        env.storage().instance().extend_ttl(LIFETIME_THRESHOLD, BUMP_AMOUNT);
    }

    fn payout(env: &Env, data: &EscrowData, to: &Address) {
        token::Client::new(env, &data.token).transfer(&env.current_contract_address(), to, &data.amount);
    }
}

#[cfg(test)]
mod test {
    extern crate std;

    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger};

    fn create_token<'a>(env: &Env, admin: &Address) -> (Address, token::StellarAssetClient<'a>, token::Client<'a>) {
        let sac = env.register_stellar_asset_contract_v2(admin.clone());
        let address = sac.address();
        (address.clone(), token::StellarAssetClient::new(env, &address), token::Client::new(env, &address))
    }

    fn setup<'a>() -> (Env, EscrowClient<'a>, Address, Address, Address, token::Client<'a>) {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let arbiter = Address::generate(&env);

        let (token_address, sac_admin, token_client) = create_token(&env, &admin);
        sac_admin.mint(&buyer, &1_000_000_000i128);

        let amount: i128 = 500_000_000;
        let deadline: u32 = env.ledger().sequence() + 1000;
        let contract_id = env.register(
            Escrow,
            (&buyer, &seller, &arbiter, &token_address, &amount, &deadline),
        );
        let client = EscrowClient::new(&env, &contract_id);

        (env, client, buyer, seller, arbiter, token_client)
    }

    #[test]
    fn test_full_happy_path_release() {
        let (_env, client, buyer, seller, _arbiter, token) = setup();

        assert_eq!(client.get_status(), EscrowStatus::Pending);
        client.fund();
        assert_eq!(client.get_status(), EscrowStatus::Funded);
        assert_eq!(token.balance(&client.address), 500_000_000);

        client.release();
        assert_eq!(client.get_status(), EscrowStatus::Released);
        assert_eq!(token.balance(&seller), 500_000_000);
        assert_eq!(token.balance(&buyer), 500_000_000);
    }

    #[test]
    fn test_seller_refund() {
        let (_env, client, buyer, _seller, _arbiter, token) = setup();

        client.fund();
        client.refund();

        assert_eq!(client.get_status(), EscrowStatus::Refunded);
        assert_eq!(token.balance(&buyer), 1_000_000_000);
    }

    #[test]
    fn test_dispute_resolution_favors_seller() {
        let (_env, client, _buyer, seller, _arbiter, token) = setup();

        client.fund();
        client.open_dispute(&seller);
        assert_eq!(client.get_status(), EscrowStatus::Disputed);

        client.resolve_dispute(&true);
        assert_eq!(client.get_status(), EscrowStatus::Released);
        assert_eq!(token.balance(&seller), 500_000_000);
    }

    #[test]
    fn test_timeout_refund_after_deadline() {
        let (env, client, buyer, _seller, _arbiter, token) = setup();

        client.fund();
        env.ledger().set_sequence_number(env.ledger().sequence() + 2000);

        client.claim_timeout_refund();
        assert_eq!(client.get_status(), EscrowStatus::Refunded);
        assert_eq!(token.balance(&buyer), 1_000_000_000);
    }

    #[test]
    fn test_cannot_release_before_funding() {
        let (_env, client, _buyer, _seller, _arbiter, _token) = setup();
        assert!(client.try_release().is_err());
    }

    #[test]
    fn test_cannot_double_fund() {
        let (_env, client, _buyer, _seller, _arbiter, _token) = setup();
        client.fund();
        assert!(client.try_fund().is_err());
    }
}