// Dependency loading is the unavoidable Promise boundary: doctor must remain actionable without node_modules.
import("./sdk-verification-runner.mjs").catch((error) => {
  // Unexpected loader defects must remain visible, not masquerade as a missing installation.
  if (error.code !== "ERR_MODULE_NOT_FOUND" && error.code !== "MODULE_NOT_FOUND") throw error;
  console.error(
    `FAIL verification bootstrap (${error.code ?? error.name}); run pnpm run doctor and install the locked dependencies explicitly.`,
  );
  console.error("SKIPPED verification stages: tooling unavailable");
  process.exitCode = 1;
});
