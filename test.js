/**
 * Subscription Plans per the PRD
 * Therapist Plans (controls commission rate)
 * 
    Tier	Price	            Commission
    Basic	Free	            20%
    Pro	    $19/mo ·$190/yr	    12%
    Elite	$39/mo ·$351/yr	    7%

 */


/**
 * Customer Plans (controls post/therapist limits)
 * 
 * Tier	        Price	                Posts	        Therapists	        Extras
    Free	    Free	                5	            5	                 —
    Standard	$49/mo · $530/yr	    10	            10	                 —
    Premium	    $129/mo · $1,071/yr	    Unlimited	Unlimited	Elite filter + dedicated coordinator

    Both sides - get a 30-day free trial
 */

/**
 * Commission management and subscription billing are 2 independent systems that happen to be related
 * 
 * - Commission rate logic (which % applies at payment time) -> Not blocked -> Just needs a tier -> rate mapping
 * - Subscription billing (Stripe Products, Price IDs, webhooks, upgrade flows) -> Blocked -> Needs finalizing
 * pricing from stakeholders
 * 
 * 
 * Recommendation: Implement the Logic layer now, Skip billing
 * what to build now:
 * 1. Add planTier to TherapistProfile - a single enum field (basic | pro | elite default basic), No full subscription
 * model needed yet. This is the minimum the payment service needs.
 * 2. Fix payment.service.js - Replace hardcorded env var with a real DB lookup; get the therapist's planTier -> fetch that
 * tier's commission rate from Commission Config. This is a live bug affecting every payment right now.
 * 3. Seed the Commission Config table with PRD results:
 * - Basic -> 20%
 * - Pro -> 12%
 * - Elite -> 7%
 * 4. Admin UI - let admin manually assign a therapist's tier (dropdown: Basic/pro/elite) and edit per-tier commission rates. This
 * gives you operational control without Stripe
 * 5. Update customer SubscriptionPlan enum - Add standard alongside premium. Update therapistLimit / requestLimit seeded values. But
 * don't enforce limit yet - just get the data model right
 * 
 * What to defer:
 * - Stripe Products and Price IDs - don't create these until pricing is locked 
 * - Stripe subscription webhooks (invoice.paid, subscription.updated etc)
 * - Customer subscription purchase flow / upgrade UI
 * - Automated tier assignment based on Stripe billing events
 * 
 * 
 * Why this works:
 * When stakeholder finalize pricing, the only new work is:
 * - Create Stripe Products/Price
 * - Build the subscription purchase flow
 * - Wire the webhook: invoice.paid -> set therapist.planTier = "pro"
 * 
 * On Seed Data for Demos
 * - Demo the full commission flow (therapist on Pro gets 12% taken, Elite gets 7%)
 * - SHow admin tier management in the admin panel
 * - Prove the end to end payment math is correct
 */