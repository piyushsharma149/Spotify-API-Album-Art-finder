/*
=-=-=-=-=-=-=-=-=-=-=-=-
Album Art Search
=-=-=-=-=-=-=-=-=-=-=-=-
Student ID:
Comment (Required):

=-=-=-=-=-=-=-=-=-=-=-=-
*/

const fs = require ('fs');
const http = require('http');
const https = require('https');
const querystring = require('querystring');
const { mainModule } = require('process');
const port = 3000;
const server = http.createServer();



const{client_id, client_secret} = require('./auth/credentials.json');


server.on("request", connection_handler);
function connection_handler(req, res){
	console.log(`New Request for ${req.url} from ${req.socket.remoteAddress}`);

	if (req.url === "/"){
		const main = fs.createReadStream('html/main.html');
		res.writeHead(200, {"Content-Type" : "text/html"});		//if text/plain is used then it displays actual html code
		main.pipe(res);
	}
	else if (req.url === "/favicon.ico") {
		const favicon = fs.createReadStream('images/favicon.ico');
		res.writeHead(200, {"Content-Type" : "image/x-icon"});		
		favicon.pipe(res);
	}
	else if (req.url === "/images/banner.jpg") {
		const banner = fs.createReadStream('images/banner.jpg');
		res.writeHead(200, {"Content-Type" : "image/jpeg"});		
		banner.pipe(res);
	}
	else if (req.url.startsWith("/album-art/")){
		const image_stream = fs.createReadStream(`.${req.url}`);
		
		image_stream.on('error', image_error_handler);
		function image_error_handler(err){
			res.writeHead(404,{"Content-Type": "text/plain"});
			res.write("404 not found",() => res.end());
		}

		image_stream.on('ready', deliver_image);
		function deliver_image(){
			res.writeHead(200, {"Content-Type": "image/jpeg"});
			image_stream.pipe(res);
		}
	}
	else if (req.url.startsWith("/search")){
		const url = new URL (req.url, "https://localhost:3000");
		const artist = url.searchParams.get("artist");

		const token_cache_file = './auth/authentication-res.json';
		let cache_valid = false;		//assume cache doesnt exist therefore false
		if(fs.existsSync(token_cache_file)){		//if cache exists 
			cached_token_object = require(token_cache_file);
			if(new Date(cached_token_object.expiration) > Date.now()){		//if valid date is greater than current date then its valid
				cache_valid = true;		
			}
		}

		if(cache_valid){		//if it is valid, we can bypass all functions called by request_access_token and straight to create_search_request
			let access_token = cached_token_object.access_token;
			console.log("cache exists and is valid");
			create_search_request(access_token, artist, res);
		}
		else{
			request_access_token(artist, res);
		}

	}
	else {
		res.writeHead(404, {"Content-Type": "text/plain"});
		res.write("404 Not Found", () => res.end());
	}
	
}

function stream_to_message(stream, callback, ...args){
	 let body = "";
	 stream.on("data", chunk => body += chunk);
	 stream.on("end", () => callback(body, ...args));
}

function request_access_token(artist, res){

	const{client_id, client_secret} = require('./auth/credentials.json')
	let base64data = Buffer.from(`${client_id}:${client_secret}`).toString('base64');
	const options = {
		method:"POST",
		headers:{
			"Content-Type":'application/x-www-form-urlencoded',
			"Authorization": `Basic ${base64data}`
		}
	};


	const post_data = querystring.stringify({grant_type : "client_credentials"});
	const token_endpoint = "https://accounts.spotify.com/api/token";
	const token_request_time = new Date();
	const token_request = https.request(token_endpoint, options);
	token_request.once("error", err => {throw err});
	token_request.once("response", (token_stream) => stream_to_message(token_stream, received_token, artist, token_request_time, res));
	token_request.end(post_data); //( , ()=> token_endpoint.end())
}

function received_token(serialized_token_object, artist, token_request_time, res){
	let token_object = JSON.parse(serialized_token_object);
	let access_token = token_object.access_token;
	console.log(token_object);
	create_access_token_cache(token_object, token_request_time);
	create_search_request(access_token, artist, res);
}

function create_access_token_cache(token_object, token_request_time){
	token_object.expiration = new Date(token_request_time.getTime() + (token_object.expires_in * 1000));
	//console.log("Current DT", new Date());
	console.log("Token Object",  token_object);
	fs.writeFile('./auth/authentication-res.json', JSON.stringify(token_object), () => console.log("Access Token Cached"));

}


function create_search_request(access_token, artist, res){ //from spotify methods
	const options = {
		method:"GET",		//if we had https.get below, then no need of this
		headers:{
			"Authorization": `Bearer ${access_token}`
		}
	};

	const search_query = querystring.stringify({type:"album", q:artist});
	

	const search_endpoint = `https://api.spotify.com/v1/search?${search_query}`;
	const search_request = https.request(search_endpoint, options); //same as https.get()
	search_request.once("error", err => {throw err});
	search_request.once("response", (search_result_stream) => stream_to_message(search_result_stream, received_search_result, artist, res));
	search_request.end();
}


function received_search_result(serialized_search_object, artist, res){
	const search_results = JSON.parse(serialized_search_object);
	const albums = search_results.albums.items;		//stores url of each album 
	const album_art_url = albums.map(albums => albums.images[1].url);	//applies a function to albums and returns each url  
	const downloaded_images = {images: [], total: album_art_url.length};
	album_art_url.map(url => {
		let tokenized_url = url.split("/");
		let filename = tokenized_url[tokenized_url.length -1];
		const img_path = `album-art/${filename}.jpg`;

		fs.access(img_path, fs.constants.F_OK, (err) => {
			if(err){
				download_image(url, downloaded_images, artist, res);
			}
			else{
				downloaded_images.images.push(img_path);
				console.log("Image is cached", img_path);
				if(downloaded_images.images.length >= downloaded_images.total){
					generate_webpage(downloaded_images.images, artist, res);
				}
			}
		});
		
	});		//essentially a loop, calls download_images multiple times and downloads all 20 images
}

function download_image(url, downloaded_images, artist, res){
	let tokenized_url = url.split("/");
	let filename = tokenized_url[tokenized_url.length -1];
	const img_path = `album-art/${filename}.jpg`;
	const image_request = https.get(url, );
	image_request.on("response", function receive_image_data(image_stream){
		const save_image = fs.createWriteStream(img_path, {encoding:null});
		image_stream.pipe(save_image);
		save_image.on("finish", function(){
			downloaded_images.images.push(img_path);
			console.log("Donwloaded Image", img_path);
			if(downloaded_images.images.length >= downloaded_images.total){
				generate_webpage(downloaded_images.images, artist, res);
			}
		})
	
	})
}

function generate_webpage(image_urls, artist, res){
	let image_component =  image_urls.map(image_url => `<img_src="${image_url}">`).join("");
	res.writeHead(200, {"Content-Type" : "text/html"});
	res.end(`<h1>${artist}<h1> ${image_component}`);

	
}

server.on("listening", listening_handler);
server.listen(port);
function listening_handler(){
	console.log(`Now Listening on Port ${port}`);
}

