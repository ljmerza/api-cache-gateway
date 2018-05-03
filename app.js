const http = require('http');
const querystring = require('querystring')
const fs = require('fs');

const express = require('express');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const cors = require('cors');


const myPort = 8173;

// set apache to proxy to this
// ProxyPass "28173/" "http://localhost:58173/UD-ember/"
const expressPort = `2${myPort}`;
const mojoPort = `3${myPort}`; // set mojo to this port
const cachedTimeout = 3000; // timeout to set if we already have cached response

const corsOptions = {
	origin: `:${myPort}`,
	optionsSuccessStatus: 200,
	credentials: true
}

/**
 *
 */
function buildRequestOptions(expressRequest, timeout){

	const cookies = Object.keys(expressRequest.cookies)
		.map(cookie => `cookie=${expressRequest.cookies[cookie]}`)
		.join(';');

	let defaultOptions = { 
	    hostname: '127.0.0.1',
	    path: expressRequest.url,
	    port: mojoPort,
	    method: expressRequest.method,
	    headers: Object.assign({}, {'Cookie': cookies}, expressRequest.headers),
	    timeout: timeout || 0
	};

	if(['POST', 'PUT'].includes(expressRequest.method)){
		const bodyKey = Object.keys(expressRequest.body)[0];
		defaultOptions.body = bodyKey;
		defaultOptions.headers['Content-Length'] = Buffer.byteLength(querystring.stringify(defaultOptions.body))
	}

	return defaultOptions;
}


const app = express();
app.use(cookieParser());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cors(corsOptions));


app.get('/*', (expressRequest, expressResponse) => {
	let getTimeout = 0;

	// set timeout if file exists
	const fileName = createFileName(expressRequest.url);
	const filePath = createFilePath(fileName);

	fs.readFile(filePath, (err, fileData) => {
		if(!err && fileData) getTimeout = cachedTimeout;
		let options = buildRequestOptions(expressRequest, getTimeout);

		// make HTTP request
		http.request(options, mojoResponse => {
			let mojoResponseData = '';

			mojoResponse.on('data', chunk => {
				mojoResponseData += chunk;
			});

			mojoResponse.on('end', () => {
				saveResponse(mojoResponseData, expressRequest.url, expressResponse, mojoResponse.statusCode);
			});
		 
		})
		.on('error', err => {
			if(fileData && !/favicon./.test(expressRequest.url)){
				return expressResponse.send(addCacheResponse(fileData));
			}

			return expressResponse.send({status: `Node error ${err}`});
		})
		.end();
	});
});

app.post('/*', (expressRequest, expressResponse) => {
	let options = buildRequestOptions(expressRequest);

	// make get request to mojo
	http.request(options, mojoResponse => {
		let mojoResponseData = '';

		mojoResponse.on('data', function(chunk){
			mojoResponseData += chunk;
		});
		mojoResponse.on('end', function(){
			return expressResponse.send(mojoResponseData);
		});
	 
	})
	.on('error', err => {
		return expressResponse.send({status: `Node error ${err}`});
	})
	.end();
})


app.listen(expressPort, function() {
	console.log('listening on port ' + expressPort);
});

/**
 *
 *
 */
function saveResponse(mojoResponseData, url, expressResponse, statusCode){
	if(!/favicon./.test(url)){
		try {
			let parsedResponse = JSON.parse(mojoResponseData);
			const fileName = createFileName(url);
			const filePath = createFilePath(fileName);

			// if error then try to read from local cache
			if(statusCode !== 200 || /ERROR/.test(parsedResponse.status)){
				fs.readFile(filePath, (err, data) => {

					// if we gt something back from local cache then save
					if(!err){
						parsedResponse = addCacheResponse(data);
					}

					// always save any errors and return what we got
					parsedResponse.cachedError = err;
					return expressResponse.send(parsedResponse);
				});

			} else {
				const buf = Buffer.from(JSON.stringify(parsedResponse));

				// if we got back an okay status then save payload and return response
				fs.writeFile(filePath, buf, err => {
				    if(err) parsedResponse.cache_error = err;
				    return expressResponse.send(parsedResponse);
				});
			}

		} catch(err){
			// we couldn't parse response so just send it back
			return expressResponse.send(mojoResponseData);
		}
	}
}

function addCacheResponse(data){
	let parsedResponse = JSON.parse(data.toString());
	parsedResponse.cachedResponse = true;
	return parsedResponse;
}

/**
 *
 *
 */
function createFileName(url){
	const fileName = url.replace(/\/|=|\.|,|\?/g, '.');
	return `${fileName}.json`;
}

/**
 *
 *
 */
function createFilePath(fileName){
	return 'cachedFiles/cache'+fileName
}