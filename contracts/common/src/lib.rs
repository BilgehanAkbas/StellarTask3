#![no_std]

use soroban_sdk::{contractclient, contracterror, contracttype, Address, Env};

/// Lifecycle states of a single escrow agreement.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum EscrowStatus {
    Pending,
    Funded,
    Disputed,
    Released,
    Refunded,
    Cancelled,
}

/// Full snapshot of an escrow agreement, exposed via view calls and used
/// by the Factory contract when it performs cross-contract queries.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct EscrowData {
    pub buyer: Address,
    pub seller: Address,
    pub arbiter: Address,
    pub token: Address,
    pub amount: i128,
    pub deadline_ledger: u32,
    pub status: EscrowStatus,
}

/// Errors shared by the Escrow and Factory contracts.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum EscrowError {
    NotPending = 1,
    NotFunded = 2,
    NotDisputed = 3,
    DeadlineNotReached = 4,
    DeadlineAlreadyPassed = 5,
    InvalidAmount = 6,
    InvalidParties = 7,
    Unauthorized = 8,
    NotInitialized = 9,
    WasmHashNotSet = 10,
}

/// Public interface every Escrow instance exposes. The Factory contract
/// uses the generated `EscrowClient` to call live Escrow instances it has
/// deployed — this is the inter-contract communication layer.
#[contractclient(name = "EscrowClient")]
pub trait EscrowInterface {
    fn get_status(env: Env) -> EscrowStatus;
    fn get_details(env: Env) -> EscrowData;
}