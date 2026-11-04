
export default function Home() {
  return (
    <main className="min-h-screen bg-background px-6 py-8 md:px-10">
      {/* Header */}
      <header className="mb-8">
        <h1 className="text-2xl font-semibold text-foreground">
          Lowcountry Orphan Relief Inventory
        </h1>
      </header>

      {/* Location and year filters */}
      <section className="mb-6">
        <div className="flex flex-wrap gap-6">
          <div className="min-w-48">
            <label className="mb-2 block text-sm font-medium text-foreground">
              Location
            </label>
            <div className="rounded-md border border-input bg-muted px-4 py-2 text-sm text-muted-foreground">
              Lowcountry
            </div>
          </div>

          <div className="min-w-48">
            <label className="mb-2 block text-sm font-medium text-foreground">
              Year
            </label>
            <div className="rounded-md border border-input bg-muted px-4 py-2 text-sm text-muted-foreground">
              Select year
            </div>
          </div>
        </div>
      </section>

      {/* Annual inventory summary */}
      <section className="mb-6 rounded-lg border border-border bg-card p-6">
        <h2 className="text-lg font-semibold text-card-foreground">
          Annual Inventory Summary
        </h2>
      </section>

      {/* Inventory table */}
      <section className="w-full rounded-lg border border-border bg-card p-6">
        <h2 className="mb-4 text-lg font-semibold text-card-foreground">
          Inventory
        </h2>
      </section>
    </main>
  );
}
