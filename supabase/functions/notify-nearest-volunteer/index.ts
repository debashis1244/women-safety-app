import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Haversine formula to calculate distance between two lat/lon points
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
    const R = 6371e3; // metres
    const φ1 = lat1 * Math.PI / 180; // φ, λ in radians
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    const d = R * c; // in metres
    return d; // returns distance in meters
}

serve(async (req) => {
    // Initialize Supabase client with the Service Role Key for elevated privileges
    // (This key is needed to read all volunteers' locations, bypassing RLS if set)
    const supabaseClient = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    if (req.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
    }

    try {
        const payload = await req.json();
        console.log("Webhook payload received:", payload);

        // Ensure this webhook is only triggered by INSERT on the 'locations' table
        // and that it's an initial emergency signal (status 'active' and not yet assigned)
        if (payload.type === "INSERT" && payload.table === "locations") {
            const emergencyLocation = payload.record; // The new row inserted into 'locations'

            const { latitude: emergencyLat, longitude: emergencyLon, session_id: sessionId } = emergencyLocation;

            // Check if this emergency is active and not already assigned
            // This prevents re-notifying if location updates for an already assigned session.
            if (emergencyLocation.status !== 'Active' || emergencyLocation.assigned_volunteer_id !== null) {
                console.log(`Emergency session ${sessionId} already processed or not active. Ignoring.`);
                return new Response("Emergency already processed or not active.", { status: 200 });
            }

            if (!emergencyLat || !emergencyLon || !sessionId) {
                console.warn("Missing latitude, longitude, or session_id in emergency record.");
                return new Response("Invalid emergency record", { status: 400 });
            }

            console.log(`New active emergency at: (${emergencyLat}, ${emergencyLon}) for session: ${sessionId}`);

            // 1. Fetch all available volunteers
            const { data: volunteers, error: volunteerError } = await supabaseClient
                .from('Volunteer')
                .select('id, latitude, longitude, contact_number') // Make sure to select contact_number
                .eq('is_available', true); // Only available volunteers

            if (volunteerError) {
                console.error("Error fetching volunteers:", volunteerError);
                return new Response(`Error fetching volunteers: ${volunteerError.message}`, { status: 500 });
            }

            if (!volunteers || volunteers.length === 0) {
                console.log("No available volunteers found.");
                return new Response("No available volunteers.", { status: 200 });
            }

            // 2. Find the nearest volunteer
            let nearestVolunteer = null;
            let minDistance = Infinity;

            for (const volunteer of volunteers) {
                // Ensure volunteer has valid coordinates
                if (volunteer.latitude && volunteer.longitude) {
                    const distance = haversineDistance(
                        emergencyLat, emergencyLon,
                        volunteer.latitude, volunteer.longitude
                    );
                    if (distance < minDistance) {
                        minDistance = distance;
                        nearestVolunteer = volunteer;
                    }
                }
            }

            if (nearestVolunteer) {
                console.log(`Nearest volunteer found: ${nearestVolunteer.id} at distance ${minDistance.toFixed(2)} meters.`);

                // Construct a Google Maps link for easy access
                // Note: The `http://googleusercontent.com/maps.google.com/` prefix is a common trick
                // to make the link clickable in many messaging apps that might block direct maps.google.com links.
                const mapsLink = `http://googleusercontent.com/maps.google.com/4{emergencyLat},${emergencyLon}`;
                const notificationMessage = `🚨 Emergency Alert! Session ID: ${sessionId}. Tap for location: ${mapsLink}. Nearest volunteer: ${nearestVolunteer.id}. Distance: ${minDistance.toFixed(2)} meters.`;

                // 3. Notify the nearest volunteer (e.g., via SMS, push notification, or update a 'notifications' table)
                // FOR DEMONSTRATION, THIS IS A CONSOLE LOG.
                // Replace this section with actual SMS (Twilio) or Push Notification API calls.
                console.log("SIMULATING NOTIFICATION (SMS to", nearestVolunteer.contact_number, "):", notificationMessage);

                // --- Placeholder for actual SMS sending (e.g., Twilio) ---
                /*
                // Example with Twilio (You need to install Twilio NPM package for Deno: 'npm:twilio' in import map if using in Deno)
                // You would need to set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER as Supabase Function Secrets.
                // const Twilio = await import('npm:twilio');
                // const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
                // const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
                // const TWILIO_PHONE_NUMBER = Deno.env.get("TWILIO_PHONE_NUMBER"); // Your Twilio sending number

                // if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_PHONE_NUMBER && nearestVolunteer.contact_info) {
                //     const client = Twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
                //     try {
                //         await client.messages.create({
                //             body: notificationMessage,
                //             from: TWILIO_PHONE_NUMBER,
                //             to: nearestVolunteer.contact_info // Assuming contact_info is a phone number
                //         });
                //         console.log("SMS sent successfully to:", nearestVolunteer.contact_info);
                //     } catch (smsError) {
                //         console.error("Failed to send SMS:", smsError);
                //     }
                // } else {
                //     console.warn("Twilio credentials or volunteer contact number missing. SMS not sent.");
                // }
                */
                // --- End of SMS placeholder ---


                // 4. Update the emergency record in the 'locations' table to mark it as assigned
                // This is crucial to prevent re-notifying the same volunteer for ongoing location updates.
                const { error: updateError } = await supabaseClient
                    .from('locations')
                    .update({
                        assigned_volunteer_id: nearestVolunteer.id,
                        status: 'assigned' // Set status to 'assigned'
                    })
                    // Assuming 'session_id' is unique for the latest location record, or you are updating the specific 'id'
                    // If you added an 'id' column to 'locations', use .eq('id', emergencyLocation.id) instead of .eq('timestamp').
                    .eq('session_id', sessionId)
                    .eq('timestamp', emergencyLocation.timestamp); // Targeting the specific row that triggered the webhook

                if (updateError) {
                    console.error("Error updating emergency status in locations table:", updateError);
                } else {
                    console.log(`Emergency session ${sessionId} assigned to volunteer ${nearestVolunteer.id} and status updated.`);
                }

                return new Response(JSON.stringify({ message: "Nearest volunteer notified.", volunteerId: nearestVolunteer.id, distance: minDistance }), {
                    headers: { "Content-Type": "application/json" },
                    status: 200,
                });

            } else {
                console.log("No volunteers with valid coordinates found to calculate distance.");
                return new Response(JSON.stringify({ message: "No volunteers with valid coordinates found." }), {
                    headers: { "Content-Type": "application/json" },
                    status: 200,
                });
            }
        } else {
            // Ignore events that are not INSERTs on the 'locations' table, or are not 'active' emergencies.
            console.log("Ignoring non-INSERT event or other table event.");
            return new Response("Not an INSERT event on locations table or not relevant.", { status: 200 });
        }
    } catch (error) {
        console.error("Function execution error:", error.message);
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { "Content-Type": "application/json" },
            status: 400,
        });
    }
});