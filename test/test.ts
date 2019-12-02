import net from 'net';
import url from 'url';
import http from 'http';
import assert from 'assert';
import listen from 'async-listen';
import { Agent, RequestOptions } from '../src';

const req = (opts: http.RequestOptions): Promise<http.IncomingMessage> => {
	return new Promise(resolve => {
		const req = http.request(opts, resolve);
		req.end();
	});
};

describe('Agent (TypeScript)', () => {
	describe('subclass', () => {
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
});

describe('"http" module', () => {
	it('should work for basic HTTP requests', async () => {
		let gotReq = false;
		let gotCallback = false;

		const agent = new Agent(
			(req: http.ClientRequest, opts: RequestOptions): net.Socket => {
				gotCallback = true;
				return net.connect(opts);
			}
		);

		const server = http.createServer((req, res) => {
			gotReq = true;
			res.setHeader('X-Foo', 'bar');
			res.setHeader('X-Url', req.url || '/');
			res.end();
		});
		await listen(server);

		const addr = server.address();
		if (typeof addr === 'string') {
			throw new Error('Server did not bind to a port');
		}

		try {
			const info = url.parse(`http://127.0.0.1:${addr.port}/foo`);
			const res = await req({ agent, ...info });
			assert.equal('bar', res.headers['x-foo']);
			assert.equal('/foo', res.headers['x-url']);
			assert(gotReq);
			assert(gotCallback);
		} finally {
			server.close();
		}
	});
});
