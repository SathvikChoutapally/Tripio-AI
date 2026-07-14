/**
 * TripioAI — Email Confirmation Service (Resend Integration)
 */

import { Resend } from 'resend';

// Initialize Resend
const resendApiKey = process.env.RESEND_API_KEY || 're_mock_key';
const resend = new Resend(resendApiKey);

/**
 * Send a booking confirmation email with the itinerary PDF attachment.
 * @param {Object} params
 * @param {string} params.to - Recipient email
 * @param {string} params.passengerName - Passenger name
 * @param {Object} params.trip - Trip details
 * @param {Object} params.booking - Booking details
 * @param {Object} params.flightOffer - Flight details
 * @param {Object} params.hotelOffer - Hotel details
 * @param {Buffer} params.pdfBuffer - Generated PDF buffer
 */
export async function sendBookingConfirmation({
  to,
  passengerName,
  trip,
  booking,
  flightOffer,
  hotelOffer,
  pdfBuffer,
}) {
  const fromEmail = process.env.FROM_EMAIL || 'onboarding@resend.dev';
  
  if (resendApiKey === 're_mock_key') {
    console.log('[Email Mock] RESEND_API_KEY is not configured. Simulating successful email send.');
    console.log(`[Email Mock] To: ${to}, From: ${fromEmail}, Subject: TripioAI Booking Confirmation`);
    return { id: 'mock_send_success' };
  }

  const subject = `Your TripioAI Booking Confirmation: ${trip.origin_city.split(',')[0]} to ${trip.destination_city.split(',')[0]}`;
  
  const flightDetailsHtml = flightOffer 
    ? `<li><strong>Flight:</strong> ${flightOffer.airline} (${flightOffer.stops === 0 ? 'Non-stop' : `${flightOffer.stops} stops`}, duration: ${Math.floor(flightOffer.duration_minutes / 60)}h ${flightOffer.duration_minutes % 60}m)</li>`
    : '';

  const hotelDetailsHtml = hotelOffer
    ? `<li><strong>Hotel:</strong> ${hotelOffer.hotel_name} (${hotelOffer.room_type}, ${hotelOffer.num_nights} nights)</li>`
    : '';

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
      <div style="background-color: #4f5fff; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="color: white; margin: 0;">TripioAI Booking Confirmed!</h1>
      </div>
      <div style="padding: 20px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 8px 8px;">
        <p>Dear ${passengerName || 'Traveller'},</p>
        <p>Your booking has been successfully confirmed. We have completed all reservations for your upcoming trip.</p>
        
        <h3>Trip Summary</h3>
        <ul>
          <li><strong>Route:</strong> ${trip.origin_city} to ${trip.destination_city}</li>
          <li><strong>Dates:</strong> ${trip.date_start} to ${trip.date_end}</li>
          ${flightDetailsHtml}
          ${hotelDetailsHtml}
          <li><strong>Total Amount Paid:</strong> ₹${Number(booking.amount_inr).toLocaleString('en-IN')}</li>
        </ul>

        <p>We have attached a professional PDF containing your complete itinerary, flight details, hotel voucher, and passenger records to this email.</p>
        
        <p>Thank you for booking with TripioAI!</p>
        <br />
        <p style="font-size: 12px; color: #888;">TripioAI — Powered by AI Multi-Agent Travel Planning</p>
      </div>
    </div>
  `;

  const filename = `TripioAI_Itinerary_${trip.destination_city.split(',')[0].replace(/\s+/g, '_')}.pdf`;

  try {
    const { data, error } = await resend.emails.send({
      from: fromEmail,
      to: [to],
      subject: subject,
      html: html,
      attachments: [
        {
          filename: filename,
          content: pdfBuffer,
        },
      ],
    });

    if (error) {
      throw new Error(error.message);
    }
    return data;
  } catch (err) {
    console.error('[Resend Service] Failed to send email:', err.message);
    throw err;
  }
}
