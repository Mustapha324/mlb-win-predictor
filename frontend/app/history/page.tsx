"use client";

import { useEffect, useMemo, useState } from "react";

type FilterStatus = "all" | "correct" | "incorrect";

type PredictionHistoryItem = {
  date: string;
  away_team: string;
  home_team: string;
  predicted_winner: string;
  actual_winner: string;
  probability: number;
};

const filterOptions: FilterStatus[] = ["all", "correct", "incorrect"];

export default function HistoryPage() {
  const [history, setHistory] = useState<PredictionHistoryItem[]>([]);
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("all");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const response = await fetch("http://localhost:8000/api/predictions/history", {
          cache: "no-store"
        });

        if (!response.ok) {
          throw new Error(`Failed to load prediction history (${response.status})`);
        }

        const data: PredictionHistoryItem[] = await response.json();
        setHistory(data);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Something went wrong while fetching history.";
        setError(message);
      } finally {
        setIsLoading(false);
      }
    };

    fetchHistory();
  }, []);

  const filteredHistory = useMemo(() => {
    if (statusFilter === "all") {
      return history;
    }

    return history.filter((prediction) => {
      const isCorrect = prediction.predicted_winner === prediction.actual_winner;
      return statusFilter === "correct" ? isCorrect : !isCorrect;
    });
  }, [history, statusFilter]);

  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Prediction History</h1>
        <p className="mt-2 text-slate-600">See past picks, outcomes, and model confidence.</p>
      </header>

      <section className="flex items-center gap-2">
        {filterOptions.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setStatusFilter(option)}
            className={`rounded-md border px-3 py-1.5 text-sm font-medium capitalize transition ${
              statusFilter === option
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
            }`}
          >
            {option}
          </button>
        ))}
      </section>

      <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-slate-700">
            <tr>
              <th className="px-4 py-3 font-semibold">Date</th>
              <th className="px-4 py-3 font-semibold">Away Team</th>
              <th className="px-4 py-3 font-semibold">Home Team</th>
              <th className="px-4 py-3 font-semibold">Predicted Winner</th>
              <th className="px-4 py-3 font-semibold">Actual Winner</th>
              <th className="px-4 py-3 font-semibold">Probability</th>
              <th className="px-4 py-3 font-semibold">Result</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              <tr>
                <td className="px-4 py-5 text-slate-500" colSpan={7}>
                  Loading prediction history...
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td className="px-4 py-5 text-red-600" colSpan={7}>
                  {error}
                </td>
              </tr>
            ) : filteredHistory.length === 0 ? (
              <tr>
                <td className="px-4 py-5 text-slate-500" colSpan={7}>
                  No history records found for this filter.
                </td>
              </tr>
            ) : (
              filteredHistory.map((prediction, index) => {
                const isCorrect = prediction.predicted_winner === prediction.actual_winner;

                return (
                  <tr key={`${prediction.date}-${prediction.away_team}-${prediction.home_team}-${index}`}>
                    <td className="px-4 py-3 text-slate-700">{prediction.date}</td>
                    <td className="px-4 py-3 text-slate-700">{prediction.away_team}</td>
                    <td className="px-4 py-3 text-slate-700">{prediction.home_team}</td>
                    <td className="px-4 py-3 text-slate-700">{prediction.predicted_winner}</td>
                    <td className="px-4 py-3 text-slate-700">{prediction.actual_winner}</td>
                    <td className="px-4 py-3 text-slate-700">{(prediction.probability * 100).toFixed(1)}%</td>
                    <td
                      className={`px-4 py-3 font-medium ${
                        isCorrect ? "text-emerald-600" : "text-rose-600"
                      }`}
                    >
                      {isCorrect ? "Correct" : "Incorrect"}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </section>
    </main>
  );
}
