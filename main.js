const NOOP = () => {};

function fetchLatest(onLoad, onError=NOOP) {
	let req = new XMLHttpRequest();
	req.open("GET", "https://prices.runescape.wiki/api/v1/osrs/latest");
	req.addEventListener("load", onLoad);
	req.addEventListener("error", onError);
	req.send();
}
