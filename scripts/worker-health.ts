import { workerHealthy } from '../src/common/worker-heartbeat';
process.exitCode = workerHealthy() ? 0 : 1;
