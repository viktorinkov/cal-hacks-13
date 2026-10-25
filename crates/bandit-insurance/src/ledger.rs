//! Double-entry postings for a claim's life. A journal whose debits do not
//! equal its credits is rejected before anything is written.

use crate::Cents;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Account {
    /// Expense.
    ClaimsExpense,
    /// Liability: what the venue expects to pay claimants.
    ClaimsReserve,
    /// Asset: what the insurer owes the venue.
    InsurerReceivable,
    /// Asset.
    Cash,
    /// Asset: what an attendee owes for something they broke or took.
    AttendeeReceivable,
    /// Income: what attendees pay back for losses they caused, the share that is not the insurer's.
    Recoveries,
    /// Liability: the insurer's share of a charge, which repays what the insurer paid on the claim.
    InsurerPayable,
}

impl Account {
    pub fn as_str(self) -> &'static str {
        match self {
            Account::ClaimsExpense => "claims_expense",
            Account::ClaimsReserve => "claims_reserve",
            Account::InsurerReceivable => "insurer_receivable",
            Account::Cash => "cash",
            Account::AttendeeReceivable => "attendee_receivable",
            Account::Recoveries => "recoveries",
            Account::InsurerPayable => "insurer_payable",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Line {
    pub account: Account,
    pub debit_cents: Cents,
    pub credit_cents: Cents,
    pub memo: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Journal {
    /// `J1 reserve`, `J1r reserve reversal`, `J2 receivable`, `J3 claimant payment`, `J4 reconciliation`, `J5 charge`, `J6 charge payment`.
    pub name: String,
    pub lines: Vec<Line>,
}

impl Journal {
    pub fn is_balanced(&self) -> bool {
        let debits: Cents = self.lines.iter().map(|l| l.debit_cents).sum();
        let credits: Cents = self.lines.iter().map(|l| l.credit_cents).sum();
        debits == credits
    }

    /// True when every line is zero; such a journal is not posted.
    pub fn is_empty(&self) -> bool {
        self.lines.iter().all(|l| l.debit_cents == 0 && l.credit_cents == 0)
    }
}

/// J1 at claim open: debit `claims_expense`, credit `claims_reserve`, `payout`.
pub fn reserve(payout_cents: Cents) -> Journal {
    pair("J1 reserve", Account::ClaimsExpense, Account::ClaimsReserve, payout_cents, "reserve for claim payout")
}

/// J1r when a claim is refused after J1: debit `claims_reserve`, credit `claims_expense`.
pub fn reserve_reversal(payout_cents: Cents) -> Journal {
    pair("J1r reserve reversal", Account::ClaimsReserve, Account::ClaimsExpense, payout_cents, "release reserve, claim refused")
}

/// J2 at approval or auto-settle: debit `insurer_receivable`, credit `claims_expense`, `recoverable`.
pub fn receivable(recoverable_cents: Cents) -> Journal {
    pair("J2 receivable", Account::InsurerReceivable, Account::ClaimsExpense, recoverable_cents, "recoverable from insurer")
}

/// J3 when the claimant is paid: debit `claims_reserve`, credit `cash`, `payout`.
pub fn claimant_payment(payout_cents: Cents) -> Journal {
    pair("J3 claimant payment", Account::ClaimsReserve, Account::Cash, payout_cents, "payment to claimant")
}

/// J4 when the insurer pays: debit `cash` the amount received, credit
/// `insurer_receivable` the recoverable amount, and post the difference to
/// `claims_expense` (a debit when the insurer paid less, a credit when more)
/// so the receivable closes.
pub fn insurer_payment(received_cents: Cents, recoverable_cents: Cents) -> Journal {
    let mut lines = vec![
        line(Account::Cash, received_cents, 0, "payment received from insurer"),
        line(Account::InsurerReceivable, 0, recoverable_cents, "close insurer receivable"),
    ];
    if received_cents < recoverable_cents {
        lines.push(line(Account::ClaimsExpense, recoverable_cents - received_cents, 0, "insurer paid less than recoverable"));
    } else if received_cents > recoverable_cents {
        lines.push(line(Account::ClaimsExpense, 0, received_cents - recoverable_cents, "insurer paid more than recoverable"));
    }
    Journal { name: "J4 reconciliation".to_string(), lines }
}

/// J5 when the organizer approves a charge: debit `attendee_receivable` the whole charge; credit
/// `insurer_payable` the insurer's share (what it paid on the claim, which the charge repays) and
/// `recoveries` the rest (the venue's deductible).
pub fn charge_approved(amount_cents: Cents, insurer_share_cents: Cents) -> Journal {
    let share = insurer_share_cents.min(amount_cents);
    Journal {
        name: "J5 charge".to_string(),
        lines: vec![
            line(Account::AttendeeReceivable, amount_cents, 0, "charge to the attendee responsible"),
            line(Account::InsurerPayable, 0, share, "repays the insurer's payout on the claim"),
            line(Account::Recoveries, 0, amount_cents - share, "the share the insurer did not pay"),
        ],
    }
}

/// J5r when the organizer waives an approved charge, or the attendee disputes it: J5 reversed.
pub fn charge_waived(amount_cents: Cents, insurer_share_cents: Cents) -> Journal {
    let share = insurer_share_cents.min(amount_cents);
    Journal {
        name: "J5r charge waived".to_string(),
        lines: vec![
            line(Account::InsurerPayable, share, 0, "charge waived"),
            line(Account::Recoveries, amount_cents - share, 0, "charge waived"),
            line(Account::AttendeeReceivable, 0, amount_cents, "charge waived"),
        ],
    }
}

/// J6 when the attendee pays the charge from their wallet: debit `cash`, credit `attendee_receivable`.
pub fn charge_paid(amount_cents: Cents) -> Journal {
    pair("J6 charge payment", Account::Cash, Account::AttendeeReceivable, amount_cents, "charge paid from the attendee's wallet")
}

fn line(account: Account, debit_cents: Cents, credit_cents: Cents, memo: &str) -> Line {
    Line { account, debit_cents, credit_cents, memo: memo.to_string() }
}

fn pair(name: &str, debit: Account, credit: Account, cents: Cents, memo: &str) -> Journal {
    Journal { name: name.to_string(), lines: vec![line(debit, cents, 0, memo), line(credit, 0, cents, memo)] }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lines(j: &Journal) -> Vec<(&str, Cents, Cents)> {
        j.lines.iter().map(|l| (l.account.as_str(), l.debit_cents, l.credit_cents)).collect()
    }

    /// Debits minus credits per account over a set of journals.
    fn balance(journals: &[Journal], account: Account) -> i64 {
        journals.iter().flat_map(|j| &j.lines).filter(|l| l.account == account).map(|l| l.debit_cents as i64 - l.credit_cents as i64).sum()
    }

    #[test]
    fn j1_reserve() {
        let j = reserve(18000);
        assert_eq!(j.name, "J1 reserve");
        assert_eq!(lines(&j), [("claims_expense", 18000, 0), ("claims_reserve", 0, 18000)]);
        assert_eq!(j.lines[0].memo, "reserve for claim payout");
        assert!(j.is_balanced() && !j.is_empty());
    }

    #[test]
    fn j1r_reserve_reversal() {
        let j = reserve_reversal(18000);
        assert_eq!(j.name, "J1r reserve reversal");
        assert_eq!(lines(&j), [("claims_reserve", 18000, 0), ("claims_expense", 0, 18000)]);
        assert!(j.is_balanced());
        let both = [reserve(18000), j];
        assert_eq!(balance(&both, Account::ClaimsExpense), 0);
        assert_eq!(balance(&both, Account::ClaimsReserve), 0);
    }

    #[test]
    fn j2_receivable() {
        let j = receivable(190000);
        assert_eq!(j.name, "J2 receivable");
        assert_eq!(lines(&j), [("insurer_receivable", 190000, 0), ("claims_expense", 0, 190000)]);
        assert!(j.is_balanced());
    }

    #[test]
    fn j3_claimant_payment() {
        let j = claimant_payment(18000);
        assert_eq!(j.name, "J3 claimant payment");
        assert_eq!(lines(&j), [("claims_reserve", 18000, 0), ("cash", 0, 18000)]);
        assert!(j.is_balanced());
    }

    #[test]
    fn j4_paid_in_full() {
        let j = insurer_payment(18000, 18000);
        assert_eq!(j.name, "J4 reconciliation");
        assert_eq!(lines(&j), [("cash", 18000, 0), ("insurer_receivable", 0, 18000)]);
        assert!(j.is_balanced());
    }

    #[test]
    fn j4_underpaid() {
        let j = insurer_payment(150000, 190000);
        assert_eq!(lines(&j), [("cash", 150000, 0), ("insurer_receivable", 0, 190000), ("claims_expense", 40000, 0)]);
        assert_eq!(j.lines[2].memo, "insurer paid less than recoverable");
        assert!(j.is_balanced());
    }

    #[test]
    fn j4_overpaid() {
        let j = insurer_payment(200000, 190000);
        assert_eq!(lines(&j), [("cash", 200000, 0), ("insurer_receivable", 0, 190000), ("claims_expense", 0, 10000)]);
        assert_eq!(j.lines[2].memo, "insurer paid more than recoverable");
        assert!(j.is_balanced());
    }

    #[test]
    fn zero_journals_are_empty_but_balanced() {
        for j in [reserve(0), reserve_reversal(0), receivable(0), claimant_payment(0), insurer_payment(0, 0)] {
            assert!(j.is_balanced() && j.is_empty(), "{}", j.name);
        }
    }

    #[test]
    fn property_claim_life_leaves_the_venue_cost() {
        // Payout 240000, recoverable 190000, venue cost 50000; the insurer pays in full.
        let life = [reserve(240000), receivable(190000), claimant_payment(240000), insurer_payment(190000, 190000)];
        assert!(life.iter().all(Journal::is_balanced));
        assert_eq!(balance(&life, Account::ClaimsReserve), 0);
        assert_eq!(balance(&life, Account::InsurerReceivable), 0);
        assert_eq!(balance(&life, Account::ClaimsExpense), 50000);
        assert_eq!(balance(&life, Account::Cash), -50000);
    }

    #[test]
    fn a_paid_charge_repays_the_insurer_and_the_venue() {
        // The speaker: $2,400 charged, the insurer paid $1,900, the venue carried the $500 deductible.
        let life = [charge_approved(240000, 190000), charge_paid(240000)];
        assert!(life.iter().all(Journal::is_balanced));
        assert_eq!(balance(&life, Account::AttendeeReceivable), 0);
        assert_eq!(balance(&life, Account::Cash), 240000);
        assert_eq!(balance(&life, Account::InsurerPayable), -190000);
        assert_eq!(balance(&life, Account::Recoveries), -50000);
        let waived = [charge_approved(240000, 190000), charge_waived(240000, 190000)];
        assert!([Account::AttendeeReceivable, Account::InsurerPayable, Account::Recoveries].iter().all(|a| balance(&waived, *a) == 0));
    }

    #[test]
    fn short_payment_closes_the_receivable() {
        let life = [reserve(18000), receivable(18000), claimant_payment(18000), insurer_payment(15000, 18000)];
        assert_eq!(balance(&life, Account::InsurerReceivable), 0);
        assert_eq!(balance(&life, Account::ClaimsExpense), 3000);
        assert_eq!(balance(&life, Account::Cash), -3000);
    }
}
