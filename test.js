/**
 * Overall Design - Correct for MVP
 * You correctly separated:
 * - Persistence -> Prisma + Postgres
 * - Business logic -> service layer
 * - Transport (Realtime) -> Supabase channels
 * - Delivery layer -> Express controllers
 * - Frontend sync mechanism -> broadcast events
 * 
 * Broadcast: Making something widely known, often referring to sharing
 *  private information
 * 
 * - Supabase Realtime uses a WebSocket-based pub/sub system as its
 * transports layer to broadcast changes to subscribed clients
 * 
 * 
 * WHat changed
 * ❌ Removed — getUserConversations (old)
- Grouped by contextType:contextId - meaning Sarah and John has 3 
separate conversations (request, offer, booking)

✅ Replaced with — getUserConversations (new, relationship-based)
- Groups by otherUserId:patientId -- meaning Sarah and John have one
conversation regardless how many stages they've gone through. Always
exactly 2DB queries
 * 
 */

/**
 * The user sees one continous thread per therapist-patient relationship, but under the hood, the context transitions from offer-> booking as the workflow
 * progresses. This matches how users actually think about the relationship
 * 
 * - Your business rule is also correct. A customer shouldn't have a pending offer thread AND an active booking thread simultaneously with the same therapist
 * for the same patient - because this flow is linear: offer gets accepted -> becomes a booking -> that's the only active context going forward. There's no
 * parallel branching
 * 
 * - The problem is your conversation list shows one entry per context (one for the offer, one for the booking), not one entry per relationship.
 *  A user would see "John Therapist — Offer" and "John Therapist — Booking" as two separate sidebar items, which breaks the unified thread illusion.
 */