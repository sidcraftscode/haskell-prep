// The unassessed exercise sheets are a self-contained app in public/sheets/ with its own
// interface, progress (saved in this browser) and test runner (the same in-browser runtime).
export function SheetsPage() {
  return <iframe className="sheets-frame" src={`${import.meta.env.BASE_URL}sheets/index.html`} title="Unassessed exercise sheets" />;
}
