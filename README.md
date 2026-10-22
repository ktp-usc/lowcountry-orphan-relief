This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).
## Jotform form inspection utility
A helper script is included at `scripts/jotform-inspect.mjs` to inspect the Jotform forms and submissions using the API key stored in `.env`.
### Requirements
- Node.js 18 or newer
- A valid `JOTFORM_API_KEY` value in the project root `.env` file
### Set up the API key
Create or update `.env` in the project root with:
```bash
JOTFORM_API_KEY=your_api_key_here
```
Do not print or commit the API key anywhere else. Keep it only in `.env`.
### Run the script
```bash
node scripts/jotform-inspect.mjs
```
### What the script does
- Reads the Jotform API key from `.env`
- Lists all available forms and form IDs
- Identifies likely inventory and referral forms by name
- Prints the field names, IDs, and field types for each relevant form
- Prints recent submission payloads for the inventory and referral forms
- Filters out sensitive personal info when printing referral submissions
- Helps compare the API data with the inventory Google Sheet records
### Notes
This script is meant for local inspection and validation. It does not write or store any secret outside of `.env`.
