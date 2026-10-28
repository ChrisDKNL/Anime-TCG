import { spawn } from "node:child_process";

// Starts every workspace that has a `dev` script, side by side, and stops
// them all when this process gets Ctrl-C. Kept as a script rather than a
// dependency because that is all it needs to do.
const workspaces = ["api", "web"];

const children = workspaces.map((name) =>
  spawn("npm", ["run", "dev", "--workspace", name, "--if-present"], { stdio: "inherit" }),
);

function stop(signal) {
  for (const child of children) child.kill(signal);
}

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => stop(signal));

for (const child of children) {
  child.on("exit", (code) => {
    stop("SIGTERM");
    process.exitCode = code ?? 1;
  });
}
