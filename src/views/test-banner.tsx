// Shown above the header on every public page when ENVIRONMENT !== "production".
export function TestBanner() {
  return (
    <div class="test-banner" role="note">
      Test site. Do not send real payments here.
    </div>
  );
}
