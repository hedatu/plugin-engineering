import { runServerSshDoctor, parseServerSshDoctorArgs } from "../src/server/sshDoctor.mjs";

async function main() {
  const args = parseServerSshDoctorArgs(process.argv);
  const report = await runServerSshDoctor({
    projectRoot: process.cwd(),
    inventoryRoot: args.inventoryRoot,
    server: args.server
  });
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});

