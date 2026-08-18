import { runAnalyzerTests } from './analyzers.test.js';
import { runApiTests } from './api.test.js';

async function main() {
  console.log('================================================================');
  console.log('  Running gOGig Media Pipeline Test Suite');
  console.log('================================================================');

  try {
    await runAnalyzerTests();
    await runApiTests();
    console.log('================================================================');
    console.log('  🎉 ALL UNIT AND INTEGRATION TESTS PASSED SUCCESSFULLY!');
    console.log('================================================================\n');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Test Suite Failed:', err);
    process.exit(1);
  }
}

main();
