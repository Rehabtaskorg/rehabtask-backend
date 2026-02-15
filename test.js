/**
 * The 5-document limit is enforced at the business logic in (upload.service.js)
 * not at the multer level. Here's how it works.
 * 
 * Multer Level (per Request)
 * - Accepts 1 file per request -> single('file')
 * - This prevents memory issues from large batch uploads
 * 
 * Service Level (Total Documents)
 * - Checks total active documents < 5
 * - This is in your upload.service.js 
 * 
 * Frontend Level (User Experience)
 * - Users can upload multiple time (one at a time)
 * - Your CredentialsPage.jsx already handles this with the dropzone
 * - Users sees 5/5 limit in the UI
 * 
 * You current Flow (working)
 * 1. User stops 3 files in UI
 * 2. Frontend loops: Upload file 1 -> success
 * 3. Frontend loops: Upload file 2 -> success
 * 4. Frontend loops: Upload file 3 -> success
 * 5. Database now has 3 documents
 * 6. User drops 3 more files
 * Frontend loops: Upload file 4 → Success
Frontend loops: Upload file 5 → Success
Frontend loops: Upload file 6 → ❌ BLOCKED (backend checks: 5 documents exist)
 */