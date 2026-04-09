/**
 * Problem 1: createCheckoutSession doesn't cancel the old Stripe Subscripton. when
 * a customer clicks "Upgrade to Standard" while already on Standard, Stripe creates
 * a new subscription - it doesn't replace the old one. The old subscription keeps charging
 * 
 * Problem 2: handleCheckoutCompleted finds existing by customerId and updates it. This
 * is correct for upgrading a trial/free subscription. 
 * 
 * How Production Subscription Sytems Handles Upgrades
 * Action => Correct Approach
 * 
 * Free -> Standard     => Create a new Stripe subscription (current behavior)
 * Trial -> Standard    => Create a new Stripe subscription (current behavior)
 * Standard -> Premium  => Cancel old Stripe sub, create a new one OR use stripe.subscriptions.update() to change the price
 * Premium -> Standard  => Downgrade via Stripe Billing portal (proration handled by Stripe)
 * Any paid -> Same Plan => Block - show "You're already on this plan"
 */