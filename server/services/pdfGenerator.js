/**
 * TripioAI — PDF Booking Confirmation Generator
 * Uses pdfkit to produce a professional itinerary PDF after booking.
 */

import PDFDocument from 'pdfkit';

/**
 * Generate a booking confirmation PDF as a Buffer.
 * @param {{ booking, trip, passengers, flightOffer, hotelOffer }} data
 * @returns {Promise<Buffer>}
 */
export async function generateBookingPdf({ booking, trip, passengers, flightOffer, hotelOffer }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const buffers = [];

    doc.on('data', (chunk) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    const BRAND = '#4f5fff';
    const TEAL = '#14b8a6';
    const DARK = '#1a1a3e';

    // ── Header ──────────────────────────────────────────────────
    doc.rect(0, 0, doc.page.width, 90).fill(DARK);
    doc.fill(BRAND).fontSize(28).font('Helvetica-Bold').text('TripioAI', 50, 28);
    doc.fill('#ffffff').fontSize(11).font('Helvetica').text('Booking Confirmation', 50, 60);
    doc.moveDown(0.5);

    // ── Status badge ─────────────────────────────────────────────
    doc.y = 105;
    const statusColor = booking.booking_status === 'fully_confirmed' ? TEAL : '#f59e0b';
    doc.fill(statusColor).fontSize(13).font('Helvetica-Bold')
      .text(`Status: ${(booking.booking_status || 'confirmed').replace(/_/g, ' ').toUpperCase()}`, 50);

    doc.moveDown(0.3);
    doc.fill('#333333').fontSize(10).font('Helvetica')
      .text(`Booking ID: ${booking.id}`, 50)
      .text(`Payment ID: ${booking.razorpay_payment_id || 'N/A'}`, 50)
      .text(`Date: ${new Date(booking.created_at).toLocaleDateString('en-IN', { dateStyle: 'long' })}`, 50);

    _divider(doc);

    // ── Trip Details ────────────────────────────────────────────
    _sectionHeader(doc, 'Trip Details', BRAND);
    doc.fill('#333333').fontSize(10).font('Helvetica');
    _row(doc, 'Route', `${trip.origin_city} → ${trip.destination_city}`);
    _row(doc, 'Travel Dates', `${_fmtDate(trip.date_start)} → ${_fmtDate(trip.date_end)}`);
    _row(doc, 'Duration', `${_nights(trip.date_start, trip.date_end)} nights`);
    _row(doc, 'Passengers', `${trip.num_adults} Adult(s)${trip.num_children > 0 ? `, ${trip.num_children} Child(ren)` : ''}`);

    _divider(doc);

    // ── Passengers ──────────────────────────────────────────────
    _sectionHeader(doc, 'Passenger Information', BRAND);
    if (passengers && passengers.length > 0) {
      passengers.forEach((p, idx) => {
        doc.fill(DARK).fontSize(10).font('Helvetica-Bold')
          .text(`Passenger ${idx + 1}: ${p.first_name} ${p.last_name}`, 50);
        doc.fill('#555555').fontSize(9.5).font('Helvetica');
        _row(doc, 'Email', p.email, 60);
        _row(doc, 'Phone', p.phone, 60);
        _row(doc, 'Gender', p.gender, 60);
        _row(doc, 'Date of Birth', _fmtDate(p.date_of_birth), 60);
        _row(doc, 'Nationality', p.nationality, 60);
        doc.moveDown(0.4);
      });
    } else {
      doc.fill('#888888').fontSize(10).text('No passenger details on record.', 50);
    }

    _divider(doc);

    // ── Flight Details ──────────────────────────────────────────
    if (flightOffer) {
      _sectionHeader(doc, 'Flight Details', BRAND);
      doc.fill('#333333').fontSize(10).font('Helvetica');
      _row(doc, 'Airline', flightOffer.airline || 'N/A');
      _row(doc, 'Departure', flightOffer.departure_at ? new Date(flightOffer.departure_at).toLocaleString('en-IN') : 'N/A');
      _row(doc, 'Duration', `${Math.floor((flightOffer.duration_minutes || 0) / 60)}h ${(flightOffer.duration_minutes || 0) % 60}m`);
      _row(doc, 'Stops', flightOffer.stops === 0 ? 'Non-stop' : `${flightOffer.stops} stop(s)`);
      _row(doc, 'Duffel Booking Ref', booking.duffel_order_id || 'Processing...');
      _row(doc, 'Fare (INR)', `₹${Number(flightOffer.amount_inr || 0).toLocaleString('en-IN')}`);
      _divider(doc);
    }

    // ── Hotel Details ────────────────────────────────────────────
    if (hotelOffer) {
      _sectionHeader(doc, 'Hotel Details', BRAND);
      doc.fill('#333333').fontSize(10).font('Helvetica');
      _row(doc, 'Hotel', hotelOffer.hotel_name || 'N/A');
      _row(doc, 'Address', hotelOffer.hotel_address || 'N/A');
      _row(doc, 'Room', hotelOffer.room_type || 'Standard');
      _row(doc, 'Check-in', _fmtDate(trip.date_start));
      _row(doc, 'Check-out', _fmtDate(trip.date_end));
      _row(doc, 'Nights', `${hotelOffer.num_nights || _nights(trip.date_start, trip.date_end)}`);
      _row(doc, 'LiteAPI Booking Ref', booking.liteapi_booking_id || 'Processing...');
      _row(doc, 'Total Hotel Cost', `₹${Number(hotelOffer.total_amount_inr || 0).toLocaleString('en-IN')}`);
      _divider(doc);
    }

    // ── Payment Summary ─────────────────────────────────────────
    _sectionHeader(doc, 'Payment Summary', TEAL);
    doc.fill('#333333').fontSize(10).font('Helvetica');
    _row(doc, 'Razorpay Order ID', booking.razorpay_order_id || 'N/A');
    _row(doc, 'Payment Status', booking.payment_status?.toUpperCase() || 'N/A');
    doc.moveDown(0.2);
    doc.fill(DARK).fontSize(13).font('Helvetica-Bold')
      .text(`Total Paid: ₹${Number(booking.amount_inr || 0).toLocaleString('en-IN')}`, 50);

    _divider(doc);

    // ── Itinerary Highlights ─────────────────────────────────────
    if (trip.itinerary && trip.itinerary.length > 0) {
      _sectionHeader(doc, 'Itinerary Highlights', BRAND);
      trip.itinerary.slice(0, 5).forEach((day) => {
        doc.fill(DARK).fontSize(10).font('Helvetica-Bold')
          .text(`Day ${day.day} — ${day.theme}`, 50);
        if (day.activities && day.activities.length > 0) {
          doc.fill('#555555').fontSize(9).font('Helvetica')
            .text(`  • ${day.activities[0].name}${day.activities[1] ? ` · ${day.activities[1].name}` : ''}`, 50);
        }
        doc.moveDown(0.25);
      });
      _divider(doc);
    }

    // ── Footer ───────────────────────────────────────────────────
    doc.fill('#aaaaaa').fontSize(9).font('Helvetica')
      .text('This document is your official booking confirmation. Keep it safe.', 50, doc.page.height - 65, {
        align: 'center',
        width: doc.page.width - 100,
      })
      .text('TripioAI — Powered by AI Multi-Agent Travel Planning', 50, doc.page.height - 50, {
        align: 'center',
        width: doc.page.width - 100,
      });

    doc.end();
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _sectionHeader(doc, title, color) {
  doc.fill(color).fontSize(12).font('Helvetica-Bold').text(title, 50);
  doc.moveDown(0.3);
}

function _divider(doc) {
  doc.moveDown(0.4);
  doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).strokeColor('#e0e0e0').stroke();
  doc.moveDown(0.5);
}

function _row(doc, label, value, leftPad = 50) {
  doc.fill('#888888').font('Helvetica').fontSize(9.5).text(`${label}:`, leftPad, doc.y, { continued: true, width: 160 });
  doc.fill('#222222').font('Helvetica').text(value || 'N/A', { width: 300 });
}

function _fmtDate(dateStr) {
  if (!dateStr) return 'N/A';
  return new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function _nights(start, end) {
  if (!start || !end) return 0;
  return Math.round((new Date(end) - new Date(start)) / 86400000);
}
