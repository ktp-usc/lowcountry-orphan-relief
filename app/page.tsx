
export default function Home() {
  return (
    <main className="min-h-screen bg-gray-50 px-6 py-8 md:px-10">
      {/* Header */}
      <header className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">
          Inventory dashboard
        </h1>
      </header>

      {/* Location and year filters */}
      <section className="mb-6 rounded-lg border border-gray-200 bg-white p-5">
        <div className="flex flex-wrap gap-6">
          <div className="min-w-48">
            <label className="mb-2 block text-sm font-medium text-gray-700">
              Location
            </label>
            <div className="rounded-md border border-gray-300 bg-gray-50 px-4 py-2 text-sm text-gray-600">
              Lowcountry
            </div>
          </div>

          <div className="min-w-48">
            <label className="mb-2 block text-sm font-medium text-gray-700">
              Year
            </label>
            <div className="rounded-md border border-gray-300 bg-gray-50 px-4 py-2 text-sm text-gray-600">
              Select year
            </div>
          </div>
        </div>
      </section>

      {/* Annual inventory summary placeholder */}
      <section className="mb-6 rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900">
          Annual Inventory Summary
        </h2>

        <div
          aria-label="Inventory summary placeholder"
          className="mt-4 min-h-24 rounded-md border border-dashed border-gray-300 bg-gray-50"
        />
      </section>

      {/* Inventory table placeholder */}
      <section className="w-full rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">
          Inventory
        </h2>

        <div
          aria-label="Inventory table placeholder"
          className="min-h-64 w-full rounded-md border border-dashed border-gray-300 bg-gray-50"
        />
      </section>
    </main>
  );
}

