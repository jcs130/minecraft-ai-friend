// Installed as src/models/maw_codingplan.js; discovered by Neko's model registry.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let bridge;
export class MawCodingPlan {
    static prefix = 'mawcp';
    constructor(model) {
        if (model && model !== 'qwen3.7-plus') throw Error('NEKO_TRIAL_MODEL_NOT_ALLOWED');
    }
    async sendRequest(turns, systemMessage) {
        if (!bridge) {
            const file = process.env.MAW_NEKO_CODINGPLAN_BRIDGE_FILE;
            if (!file) throw Error('NEKO_TRIAL_MODEL_NOT_CONFIGURED');
            bridge = require(file).fromEnvironment();
        }
        return bridge.request(turns, systemMessage);
    }
    async embed() { throw Error('Neko trial uses local word-overlap retrieval; no embedding API'); }
    async sendVisionRequest() { throw Error('Neko trial vision model is not configured'); }
}
