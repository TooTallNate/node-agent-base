import fs from 'fs';
import net from 'net';
import tls from 'tls';
import url from 'url';
import http from 'http';
import https from 'https';
import assert from 'assert';
import listen from 'async-listen';
import { satisfies } from 'semver';
import { Agent, RequestOptions } from '../src';

// In Node 12+ you can just override `http.globalAgent`, but for older Node
// versions we have to patch the internal `_http_agent` module instead
// (see: https://github.com/nodejs/node/pull/25170).
// @ts-ignore
import httpAgent from '_http_agent';

const sleep = (n: number) => new Promise(r => setTimeout(r, n));

const req = (opts: https.RequestOptions): Promise<http.IncomingMessage> => {
	return new Promise((resolve, reject) => {
		(opts.protocol === 'https:' ? https : http)
			.request(opts, resolve)
			.once('error', reject)
			.end();
	});
};

const sslOptions = {
	key: fs.readFileSync(__dirname + '/ssl-cert-snakeoil.key'),
	cert: fs.readFileSync(__dirname + '/ssl-cert-snakeoil.pem')
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

	describe('"http" module', () => {
		it('should work for basic HTTP requests', async () => {
			let gotReq = false;
			let gotCallback = false;

			const agent = new Agent(
				(req: http.ClientRequest, opts: RequestOptions): net.Socket => {
					gotCallback = true;
					assert.equal(opts.secureEndpoint, false);
					assert.equal(opts.protocol, 'http:');
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
			if (!addr || typeof addr === 'string') {
				throw new Error('Server did not bind to a port');
			}
			const { port } = addr;

			try {
				const info = url.parse(`http://127.0.0.1:${port}/foo`);
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
					assert.equal(opts.protocol, 'http:');
					assert.equal(agent.defaultPort, port);
					assert.equal(opts.port, port);
					return net.connect(opts);
				}
			);

			const server = http.createServer((req, res) => {
				res.end(JSON.stringify(req.headers));
			});
			await listen(server);

			const addr = server.address();
			if (!addr || typeof addr === 'string') {
				throw new Error('Server did not bind to a port');
			}
			const { port } = addr;

			agent.defaultPort = port;

			try {
				const info = url.parse(`http://127.0.0.1:${port}/foo`);
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
					assert.equal(opts.protocol, 'http:');
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
			if (!addr || typeof addr === 'string') {
				throw new Error('Server did not bind to a port');
			}
			const { port } = addr;

			// Override the default `http.Agent.globalAgent`
			const originalAgent = httpAgent.globalAgent;
			httpAgent.globalAgent = agent;

			try {
				const info = url.parse(`http://127.0.0.1:${port}/foo`);
				const res = await req(info);
				assert.equal('bar', res.headers['x-foo']);
				assert.equal('/foo', res.headers['x-url']);
				assert(gotReq);
				assert(gotCallback);
			} finally {
				server.close();
				httpAgent.globalAgent = agent;
			}
		});

		it('should work after the first tick of the `http.ClientRequest` instance', async () => {
			let gotReq = false;
			let gotCallback = false;

			const agent = new Agent(
				async (
					req: http.ClientRequest,
					opts: RequestOptions
				): Promise<net.Socket> => {
					gotCallback = true;
					assert.equal(opts.secureEndpoint, false);
					assert.equal(opts.protocol, 'http:');
					await sleep(10);
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
			if (!addr || typeof addr === 'string') {
				throw new Error('Server did not bind to a port');
			}
			const { port } = addr;

			try {
				const info = url.parse(`http://127.0.0.1:${port}/foo`);
				const res = await req({ agent, ...info });
				assert.equal('bar', res.headers['x-foo']);
				assert.equal('/foo', res.headers['x-url']);
				assert(gotReq);
				assert(gotCallback);
			} finally {
				server.close();
			}
		});

		it('should emit an "error" event on `http.ClientRequest` instance when callback throws sync', async () => {
			let gotError = false;
			let gotCallback = false;

			const agent = new Agent(
				(req: http.ClientRequest, opts: RequestOptions): net.Socket => {
					gotCallback = true;
					throw new Error('bad');
				}
			);

			try {
				const info = url.parse('http://127.0.0.1/throws');
				await req({ agent, ...info });
			} catch (err: any) {
				gotError = true;
				assert.equal(err.message, 'bad');
			}

			assert(gotError);
			assert(gotCallback);
		});

		it('should emit an "error" event on `http.ClientRequest` instance when callback throws async', async () => {
			let gotError = false;
			let gotCallback = false;

			const agent = new Agent(
				async (
					req: http.ClientRequest,
					opts: RequestOptions
				): Promise<net.Socket> => {
					gotCallback = true;
					await sleep(10);
					throw new Error('bad');
				}
			);

			try {
				const info = url.parse('http://127.0.0.1/throws');
				await req({ agent, ...info });
			} catch (err: any) {
				gotError = true;
				assert.equal(err.message, 'bad');
			}

			assert(gotError);
			assert(gotCallback);
		});
	});

	describe('"https" module', () => {
		it('should work for basic HTTPS requests', async () => {
			let gotReq = false;
			let gotCallback = false;

			const agent = new Agent(
				(req: http.ClientRequest, opts: RequestOptions): net.Socket => {
					gotCallback = true;
					assert.equal(opts.secureEndpoint, true);
					assert.equal(opts.protocol, 'https:');
					return tls.connect(opts);
				}
			);

			const server = https.createServer(sslOptions, (req, res) => {
				gotReq = true;
				res.setHeader('X-Foo', 'bar');
				res.setHeader('X-Url', req.url || '/');
				res.end();
			});
			await listen(server);

			const addr = server.address();
			if (!addr || typeof addr === 'string') {
				throw new Error('Server did not bind to a port');
			}
			const { port } = addr;

			try {
				const info = url.parse(`https://127.0.0.1:${port}/foo`);
				const res = await req({
					agent,
					rejectUnauthorized: false,
					...info
				});
				assert.equal('bar', res.headers['x-foo']);
				assert.equal('/foo', res.headers['x-url']);
				assert(gotReq);
				assert(gotCallback);
			} finally {
				server.close();
			}
		});

		it('should work when returning another `agent-base`', async () => {
			let gotReq = false;
			let gotCallback1 = false;
			let gotCallback2 = false;

			const agent1 = new Agent(
				async (
					req: http.ClientRequest,
					opts: RequestOptions
				): Promise<Agent> => {
					gotCallback1 = true;
					assert.equal(opts.secureEndpoint, true);
					assert.equal(opts.protocol, 'https:');
					return agent2;
				}
			);

			const agent2 = new Agent(
				async (
					req: http.ClientRequest,
					opts: RequestOptions
				): Promise<net.Socket> => {
					gotCallback2 = true;
					assert.equal(opts.secureEndpoint, true);
					assert.equal(opts.protocol, 'https:');
					return tls.connect(opts);
				}
			);

			const server = https.createServer(sslOptions, (req, res) => {
				gotReq = true;
				res.setHeader('X-Foo', 'bar');
				res.setHeader('X-Url', req.url || '/');
				res.end();
			});
			await listen(server);

			const addr = server.address();
			if (!addr || typeof addr === 'string') {
				throw new Error('Server did not bind to a port');
			}
			const { port } = addr;

			try {
				const info = url.parse(`https://127.0.0.1:${port}/foo`);
				const res = await req({
					agent: agent1,
					rejectUnauthorized: false,
					...info
				});
				assert.equal('bar', res.headers['x-foo']);
				assert.equal('/foo', res.headers['x-url']);
				assert(gotReq);
				assert(gotCallback1);
				assert(gotCallback2);
			} finally {
				server.close();
			}
		});

		it('should not send a port number for the default port', async () => {
			let reqCount = 0;

			const agent = new Agent(
				(req: http.ClientRequest, opts: RequestOptions): net.Socket => {
					assert.equal(opts.secureEndpoint, true);
					assert.equal(opts.protocol, 'https:');
					assert.equal(agent.defaultPort, port);
					assert.equal(opts.port, port);
					return tls.connect(opts);
				}
			);

			const server = https.createServer(sslOptions, (req, res) => {
				reqCount++;
				res.end(JSON.stringify(req.headers));
			});
			await listen(server);

			const addr = server.address();
			if (!addr || typeof addr === 'string') {
				throw new Error('Server did not bind to a port');
			}
			const { port } = addr;

			agent.defaultPort = port;

			try {
				const info = url.parse(`https://127.0.0.1:${port}/foo`);
				const res = await req({
					agent,
					rejectUnauthorized: false,
					...info
				});
				const body = await json(res);
				assert.equal(body.host, '127.0.0.1');
				assert.equal(reqCount, 1);
			} finally {
				server.close();
			}
		});

		if (satisfies(process.version, '>= 10')) {
			it('should work when overriding `https.globalAgent`', async () => {
				let gotReq = false;
				let gotCallback = false;

				const agent = new Agent(
					(req: http.ClientRequest, opts: RequestOptions): net.Socket => {
						gotCallback = true;
						assert.equal(opts.secureEndpoint, true);
						assert.equal(opts.protocol, 'https:');
						return tls.connect(opts);
					}
				);

				const server = https.createServer(sslOptions, (req, res) => {
					gotReq = true;
					res.setHeader('X-Foo', 'bar');
					res.setHeader('X-Url', req.url || '/');
					res.end();
				});
				await listen(server);

				const addr = server.address();
				if (!addr || typeof addr === 'string') {
					throw new Error('Server did not bind to a port');
				}
				const { port } = addr;

				// Override the default `https.globalAgent`
				const originalAgent = https.globalAgent;
				https.globalAgent = agent;

				try {
					const info: https.RequestOptions = url.parse(`https://127.0.0.1:${port}/foo`);
					info.rejectUnauthorized = false;
					const res = await req(info);
					assert.equal('bar', res.headers['x-foo']);
					assert.equal('/foo', res.headers['x-url']);
					assert(gotReq);
					assert(gotCallback);
				} finally {
					server.close();
					https.globalAgent = originalAgent;
				}
			});
		}
	});
});
