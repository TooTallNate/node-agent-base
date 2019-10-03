import http from 'http';
import assert from 'assert';
import { Agent, RequestOptions, AgentCallbackCallback } from '../src';

describe('Agent (TypeScript)', () => {
	it('should be extendable (direct return)', () => {
		class MyAgent extends Agent {
			callback(
				req: http.ClientRequest,
				opts: RequestOptions
			): http.Agent {
				return http.globalAgent;
			}
		}
		const agent = new MyAgent();
		assert(agent instanceof Agent);
		assert(agent instanceof MyAgent);
	});

	it('should be extendable (promise return)', () => {
		class MyAgent extends Agent {
			async callback(
				req: http.ClientRequest,
				opts: RequestOptions
			): Promise<http.Agent> {
				return Promise.resolve(http.globalAgent);
			}
		}
		const agent = new MyAgent();
		assert(agent instanceof Agent);
		assert(agent instanceof MyAgent);
	});
});
