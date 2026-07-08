# Stock — Apple Shortcuts to install

Stock routes the non-Wegmans part of a shopping list to Apple Reminders via a
Shortcut deep link (`shortcuts://run-shortcut?...`). Build this once on the
iPhone; Stock fires it, iOS runs it. Suite pattern, same as Tick's "Add Tick
Reminder" and the Course deeplinks.

## `Add Shared Groceries`  (required)

**Name it EXACTLY** `Add Shared Groceries` — Stock calls it by that name
(`REMINDERS_SHORTCUT` in `src/lib/shopStores.ts`). A mismatch = nothing happens.

What Stock sends: the "remaining" items (everything NOT tagged Wegmans — i.e.
Stop One + Costco + unassigned), one per line, as the Shortcut's **text input**
(`&input=text&text=<url-encoded newline-joined names>`), each line already
formatted `Name, qty` (e.g. `Lemons, 3`).

### Build it (Shortcuts app → new Shortcut → add these actions)

1. **Receive** — At the top, set *Receive* `Text` from *Share Sheet* and
   *Quick Actions*. Set **"If there's no input"** → *Get clipboard* (so it also
   works if run manually after a copy).
2. **Text** → set to *Shortcut Input* (the text Stock passed in).
3. **Split Text** — Split *Text* by **New Lines**. (Output = a list of lines.)
4. **Repeat with Each** (over the *Split Text* result):
   - **Add New Reminder** — Reminder = *Repeat Item*; **List** = `Shared Groceries`.
5. Done — no need to show a result.

### One-time setup
- Create a Reminders list literally titled **`Shared Groceries`**.
- First run will prompt for Reminders permission — allow it.

### Test
Run this in Safari on the phone (should add three reminders):
```
shortcuts://run-shortcut?name=Add%20Shared%20Groceries&input=text&text=Lemons%2C%203%0AOlive%20oil%0AParsley
```

## Wegmans items
Items tagged **Wegmans** are NOT sent to Reminders. They're grouped under
Wegmans for ordering via Instacart / the Beelink instacart-agent. Stock has no
in-app Instacart push yet (only the existing "Copy → Instacart" clipboard flow),
so that side stays manual for now.
