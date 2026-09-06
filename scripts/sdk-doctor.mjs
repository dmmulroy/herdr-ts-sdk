// Keep missing dependencies diagnosable before an Effect runtime can be loaded.
import("./sdk-verification-doctor.mjs").catch((error) => {
  // Unexpected loader defects must remain visible, not masquerade as a missing installation.
  if (error.code !== "ERR_MODULE_NOT_FOUND" && error.code !== "MODULE_NOT_FOUND") throw error;
  console.log(`INFO runtime: Node ${process.versions.node} (${process.platform}/${process.arch})`);
  console.error(
    `FAIL dependencies: doctor tooling unavailable (${error.code ?? error.name}); install the locked dependencies explicitly.`,
  );
  console.error(
    "SKIPPED package manager, vendor alignment, protocol, local socket: tooling unavailable",
  );
  process.exitCode = 1;
});
