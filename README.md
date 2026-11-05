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

### Run the inspection script
```bash
node scripts/jotform-inspect.mjs
```

Optional paste-friendly output file:
```bash
node scripts/jotform-inspect.mjs --output jotform-output.txt
```

### Export a CSV of form fields
```bash
node scripts/jotform-export-fields.mjs 1234567890 --output exports/lor-fields.csv
```

The form ID is the numeric value at the end of the Jotform URL. Do not rely on form names or keyword matching.

### Inventory normalization utility

The project also includes a pure normalization helper at `lib/jotform/normalize-inventory.ts`.

This utility converts a Jotform inventory submission object into:
- normalized `SourceSubmission` metadata
- a list of inventory activity rows with item code, quantity, and direction (`IN`)

It does not hit the database or the Jotform API. It accepts:
- a Jotform form ID
- a submission object matching the Jotform API payload shape

Then it maps the configured field IDs to item codes, filters out values that are not positive whole units, and returns the normalized result. A valid `createdAt`/`created_at` or `updatedAt`/`updated_at` timestamp is required; creation timestamps take precedence over update timestamps.

#### Example usage
```bash
(
  set -e
  tmpdir="$(mktemp -d)"
  trap 'rm -r "$tmpdir"' EXIT
  ./node_modules/.bin/tsc lib/jotform/normalize-inventory.ts --module commonjs --target es2020 --skipLibCheck --outDir "$tmpdir"
  node -e "const { normalizeInventorySubmission, sampleInventorySubmissionLowcountry, sampleInventorySubmissionMidlands } = require(process.argv[1]); console.log(JSON.stringify({ lowcountry: normalizeInventorySubmission('240656204390048', sampleInventorySubmissionLowcountry), midlands: normalizeInventorySubmission('250054265404145', sampleInventorySubmissionMidlands) }, null, 2));" "$tmpdir/normalize-inventory.js"
)
```

#### What the function returns
```ts
{
  submission: {
    jotformFormId: string;
    jotformSubmissionId: string;
    location: 'LOWCOUNTRY' | 'MIDLANDS';
    sourceType: 'INVENTORY';
    submissionDate: Date;
  },
  inventoryActivities: [
    {
      itemCode: string;
      quantity: number;
      direction: 'IN';
    }
  ]
}
```

### What the script does
- Reads the Jotform API key from `.env`
- Lists all available forms and form IDs
- Targets only the exact Jotform form IDs configured in `TARGET_FORM_IDS`
- Prints field names, IDs, and field types for each target form
- Prints recent submissions for the configured forms
- Filters output to the approved field IDs for each form
- Excludes a known remove list of sensitive fields by exact ID
- Saves a sanitized pasteable text file when `--output` is used

### Safety rules
- Keep all field selection by exact Jotform field ID, not by keyword match
- Ignore other forms unless their exact IDs are added to the config
- Remove or hide names, locations, ages, and other personal identifiers before sharing output in Google Docs
- Keep the approved list narrow and conservative until the team confirms the exact safe columns

### Notes
This script is meant for local inspection and validation. It does not write or store any secret outside of `.env`.
