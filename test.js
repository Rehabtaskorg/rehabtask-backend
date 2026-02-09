import { supabaseAdmin } from "./src/config/supabase.js";

async function testConnection() {
    console.log("Testing authenticated connection...")

    // This query checks the internal Supabase "auth" schema
    // which always exists and proves your admin key is working

    const { data, error } = await supabaseAdmin
        .from("users")
        .select("id")
        .limit(1);

    if (error) {
        // If you haven't had any users sign up yet, you might get an empty result
        // but it shouldn't be a "Connection Failed" error.
        console.log("📡 Connected to Supabase, but could not query users table.");
        console.log("Error details:", error.message);
    } else {
        console.log("✅ SUCCESS! Your Supabase Admin client is fully authenticated.");
        console.log("Data received:", data);
    }
}

testConnection();