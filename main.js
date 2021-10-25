const NOOP = () => {};

// Known values for request are:
// mapping, latest, 5m, 10m, 30m, 1h, 6h, 24h
// onLoad should take the parsed data as a parameter
function fetchApi(request, onLoad, onError=NOOP) {
	let req = new XMLHttpRequest();
	req.open("GET", "https://prices.runescape.wiki/api/v1/osrs/" + request);
	req.addEventListener("load", function() {
		onLoad(JSON.parse(this.response));
	});
	req.addEventListener("error", onError);
	req.send();
}

// Cache of /mappings data
// Contains list of: {
//   id:       number,
//   name:     string,
//   icon:     string,
//   examine:  string,
//   members:  bool,
//   value:    number,
//   lowalch:  number,
//   highalch: number,
//   limit:    number,
// }
//
// Note that the documentation says this is not finalised and could change.
let mappingData = null;

fetchApi("mapping", data => {
	mappingData = data;
	updatePrices();
});

const pageLimit = 50;

// Update the table of items
function updatePrices() {
	fetchApi("1h", data => {
		let itemList = data.data;
		console.log(data);

		for (let item of mappingData) {
			let itemPriceData = itemList[item.id];
			if (!itemPriceData) {
				continue;
			}

			itemPriceData.mapping = item;
		}

		let table = document.querySelector("#results tbody");
		table.innerHTML = "";

		let rowsAdded = 0;
		for (let id of Object.keys(itemList)) {
			let itemPriceData = itemList[id];
			let item = itemPriceData.mapping;

			if (!itemPriceData.avgLowPrice || !itemPriceData.avgHighPrice) {
				continue;
			}

			let nameCell = document.createElement("td");
			nameCell.textContent = item.name;

			let lowPriceCell = document.createElement("td");
			lowPriceCell.textContent = itemPriceData.avgLowPrice;

			let highPriceCell = document.createElement("td");
			highPriceCell.textContent = itemPriceData.avgHighPrice;

			let row = document.createElement("tr");
			row.appendChild(nameCell);
			row.appendChild(lowPriceCell);
			row.appendChild(highPriceCell);

			table.appendChild(row);

			if (++rowsAdded >= pageLimit) {
				break;
			}
		}
	});
}
