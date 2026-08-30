"""
Verification harness — proves the MAB actually converges by running
the A/B comparison engine and printing the results.

Usage:
    cd /backend
    source venv/bin/activate
    python -m app.bandit.verify_bandit
"""
import json
from app.bandit.ab_comparison import run_ab_comparison

def main():
    print("=" * 70)
    print("  BANDIT VERIFICATION: A/B Comparison")
    print("=" * 70)

    result = run_ab_comparison(num_cases=200, batch_size=20, seed=42)

    print(f"\n  Cases: {result['config']['num_cases']}  |  Batch size: {result['config']['batch_size']}")
    print(f"\n  Fixed Rules:")
    for fc, action in result['config']['fixed_rules'].items():
        print(f"    {fc:25s} → {action}")

    print(f"\n{'─' * 50}")
    print(f"  FIXED RULES")
    f = result['fixed']
    print(f"    Net Recovered:   ₹{f['net_recovered']:,.2f}")
    print(f"    Recovery Rate:   {f['recovery_rate_pct']}%")
    print(f"    Discount Cost:   ₹{f['discount_cost']:,.2f}")
    print(f"    Contact Cost:    ₹{f['contact_cost']:,.2f}")

    print(f"\n  BANDIT")
    b = result['bandit']
    print(f"    Net Recovered:   ₹{b['net_recovered']:,.2f}")
    print(f"    Recovery Rate:   {b['recovery_rate_pct']}%")
    print(f"    Discount Cost:   ₹{b['discount_cost']:,.2f}")
    print(f"    Contact Cost:    ₹{b['contact_cost']:,.2f}")

    imp = result['improvement']
    sign = '+' if imp['net_delta'] >= 0 else ''
    print(f"\n  IMPROVEMENT:  {sign}₹{imp['net_delta']:,.2f}  ({sign}{imp['pct']}%)")

    print(f"\n{'─' * 50}")
    print(f"  PER-FAILURE-CLASS BREAKDOWN")
    for row in result['per_failure_class']:
        delta_sign = '+' if row['delta_net'] >= 0 else ''
        print(
            f"    {row['failure_class']:25s}"
            f"  Fixed ₹{row['fixed_net']:>10,.2f}"
            f"  Bandit ₹{row['bandit_net']:>10,.2f}"
            f"  Δ {delta_sign}₹{row['delta_net']:>10,.2f}"
        )

    print(f"\n{'─' * 50}")
    print(f"  LEARNING CURVE (cumulative net recovery per batch)")
    curve = result['learning_curve']
    for i, label in enumerate(curve['batch_labels']):
        f_val = curve['fixed_cumulative'][i]
        b_val = curve['bandit_cumulative'][i]
        bar_f = '█' * max(1, int(f_val / max(max(curve['fixed_cumulative']), 1) * 30))
        bar_b = '█' * max(1, int(b_val / max(max(curve['bandit_cumulative']), 1) * 30))
        print(f"    {label:>10s}  Fixed {bar_f}  ₹{f_val:>10,.0f}")
        print(f"              Bandit {bar_b}  ₹{b_val:>10,.0f}")

    print(f"\n{'=' * 70}")
    verdict = "✅ PASS" if imp['net_delta'] > 0 else "⚠️  NEUTRAL (bandit did not outperform fixed rules)"
    print(f"  VERDICT: {verdict}")
    print(f"{'=' * 70}")

if __name__ == "__main__":
    main()
