node-agent-base
===============
### Barebone `http.Agent` implementation

This module provides a very basic, barebones implementation of a Node.js
`http.Agent`. This can be used with the built-in `http` module.

It provides _no_ Keep-Alive support and _no_ socket pooling. It's _very_ minimal.

#### Why?

It's minimal in order to be easily extended, and to feel like I have a sense of
"control" over the underlying sockets being used by the `http` module.

This also allows for cooler things to be done in subclasses, like preprocessing
the socket somehow, or perhaps connecting the socket to a different server
entirely (think proxy servers).

#### Some subclasses:

Here's some more interesting subclasses of `agent-base`. Send a pull request to
add yours!

 * [`http-proxy-agent`][http-proxy-agent]: An HTTP(s) proxy `http.Agent` implementation for HTTP endpoints
 * [`https-proxy-agent`][https-proxy-agent]: An HTTP(s) proxy `http.Agent` implementation for HTTPS endpoints


Installation
------------

Install with `npm`:

``` bash
$ npm install agent-base
```


Example
-------

``` js
var url = require('url');
var http = require('http');
var Agent = require('agent-base');

var endpoint = 'http://nodejs.org/api/';
var opts = url.parse(endpoint);

// This is the important part!
opts.agent = new Agent();

// Everything else works just like normal...
http.get(opts, function (res) {
  console.log('"response" event!', res.headers);
  res.pipe(process.stdout);
});
```


License
-------

(The MIT License)

Copyright (c) 2013 Nathan Rajlich &lt;nathan@tootallnate.net&gt;

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
'Software'), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

[http-proxy-agent]: https://github.com/TooTallNate/node-http-proxy-agent
[https-proxy-agent]: https://github.com/TooTallNate/node-https-proxy-agent
