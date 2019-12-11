import net from 'net';
import url from 'url';
import http from 'http';
import assert from 'assert';
import listen from 'async-listen';
import { Agent, RequestOptions } from '../src';

const req = (opts: http.RequestOptions): Promise<http.IncomingMessage> => {
	return new Promise(resolve => http.request(opts, resolve).end());
};

function json(res: http.IncomingMessage): Promise<any> {
	return new Promise((resolve, reject) => {
		let data: string = '';
		res.setEncoding('utf8');
		res.on('data', b => {
			data += b;
		});
		res.on('end', () => resolve(JSON.parse(data)));
	});
}

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
				assert.equal(opts.secureEndpoint, false);
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

	it('should not send a port number for the default port', async () => {
		const agent = new Agent(
			(req: http.ClientRequest, opts: RequestOptions): net.Socket => {
				assert.equal(opts.secureEndpoint, false);
				return net.connect(opts);
			}
		);

		const server = http.createServer((req, res) => {
			res.end(JSON.stringify(req.headers));
		});
		await listen(server);

		const addr = server.address();
		if (typeof addr === 'string') {
			throw new Error('Server did not bind to a port');
		}

		agent.defaultPort = addr.port;

		try {
			const info = url.parse(`http://127.0.0.1:${addr.port}/foo`);
			const res = await req({ agent, ...info });
			const body = await json(res);
			assert.equal(body.host, '127.0.0.1');
		} finally {
			server.close();
		}
	});

	it('should work when overriding `http.globalAgent`', async () => {
		let gotReq = false;
		let gotCallback = false;

		const agent = new Agent(
			(req: http.ClientRequest, opts: RequestOptions): net.Socket => {
				gotCallback = true;
				assert.equal(opts.secureEndpoint, false);
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

		// Override the default `http.globalAgent`
		const originalAgent = http.globalAgent;
		http.globalAgent = agent;

		try {
			const info = url.parse(`http://127.0.0.1:${addr.port}/foo`);
			const res = await req(info);
			assert.equal('bar', res.headers['x-foo']);
			assert.equal('/foo', res.headers['x-url']);
			assert(gotReq);
			assert(gotCallback);
		} finally {
			server.close();
			http.globalAgent = originalAgent;
		}
	});
});
