// api.js — recommendation API stub.
//
// The real implementation will POST { question, elements, scale } to an
// external service and receive a strengths matrix back. For now it returns a
// matrix filled with 1 so the UI can be exercised end-to-end.
//
// Contract:
//   Input:
//     question  — string the user is exploring (e.g., "How related are these?")
//     elements  — string[] of element labels in display order
//     scale     — { min: number, max: number } expected value range
//   Output:
//     { matrix: number[N][N] } where matrix[i][j] is the recommended strength
//     of the relationship between elements[i] and elements[j].
//     The diagonal (i === j) is the self-self / reflexive value.

const SIMULATED_LATENCY_MS = 250;

export async function recommendInteractionValues({ question, elements, scale }) {
  // Log what would be sent to the real service. Helpful while developing the
  // backend handler — open DevTools and you'll see exactly what payload your
  // service will receive.
  console.log("[api] recommendInteractionValues request:", {
    question,
    elements,
    scale,
  });

  // Simulate network latency so the UI shows a loading state.
  await new Promise((resolve) => setTimeout(resolve, SIMULATED_LATENCY_MS));

  const n = elements.length;
  const matrix = Array.from({ length: n }, () => Array(n).fill(1));

  // Future replacement (uncomment + edit when backend is ready):
  //
  // const res = await fetch("/api/recommend", {
  //   method: "POST",
  //   headers: { "Content-Type": "application/json" },
  //   body: JSON.stringify({ question, elements, scale }),
  // });
  // if (!res.ok) {
  //   throw new Error(`recommendInteractionValues failed: ${res.status}`);
  // }
  // return await res.json(); // { matrix: number[N][N] }

  return { matrix };
}
