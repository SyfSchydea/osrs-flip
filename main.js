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

// Cache of price data from /1h, /5m, etc.
// Contains: {
//   [id]: {
//     
//   }
// }
let itemPrices = null;

// Amount of money the user is currently willing to invest.
// Updated by the input on the page.
let userCashStack = null;

const pageLimit = 50;

// Add a table cell to a table row.
function addCell(row, contents) {
	let cell = document.createElement("td");
	cell.textContent = contents;
	row.appendChild(cell);
}

// Recalculate profits, and repopulate the table
function populateTable() {
	if (itemPrices == null) {
		console.error("Attempted to update table with no price data");
		return;
	}
	let itemList = itemPrices;

	let cashStack = userCashStack;
	if (cashStack == null) {
		cashStack = 2147483647;
	}

	for (let item of mappingData) {
		let itemPriceData = itemList[item.id];
		if (!itemPriceData) {
			continue;
		}

		itemPriceData.mapping = item;

		itemPriceData.margin = itemPriceData.avgHighPrice - itemPriceData.avgLowPrice;
		itemPriceData.maxQuantity = Math.floor(cashStack / itemPriceData.avgLowPrice);
	}

	let itemEntries = Object.entries(itemList);
	itemEntries.sort((a, b) => b[1].margin - a[1].margin);

	let table = document.querySelector("#results tbody");
	table.innerHTML = "";

	let rowsAdded = 0;
	for (let [id, itemPriceData] of itemEntries) {
		let item = itemPriceData.mapping;

		if (!itemPriceData.avgLowPrice || !itemPriceData.avgHighPrice) {
			continue;
		}

		if (itemPriceData.margin <= 0) {
			continue;
		}

		if (itemPriceData.maxQuantity == 0) {
			continue;
		}

		let row = document.createElement("tr");
		addCell(row, item.name);
		addCell(row, itemPriceData.avgLowPrice);
		addCell(row, itemPriceData.avgHighPrice);
		addCell(row, itemPriceData.margin);

		table.appendChild(row);

		if (++rowsAdded >= pageLimit) {
			break;
		}
	}
}


// Update the table of items
function updatePrices() {
	fetchApi("1h", data => {
		let itemList = data.data;

		for (let item of mappingData) {
			let itemPriceData = itemList[item.id];
			if (!itemPriceData) {
				continue;
			}

			itemPriceData.mapping = item;
		}

		itemPrices = itemList;
		populateTable();
	});
}

function updateCashStack(tableUpdate=true) {
	let cashstackInput = document.querySelector("#user-cash");
	userCashStack = +cashstackInput.value;
	if (tableUpdate) {
		populateTable();
	}
}

fetchApi("mapping", data => {
	mappingData = data;
	updatePrices();
});

window.onload = () => {
	let cashstackInput = document.querySelector("#user-cash");
	cashstackInput.addEventListener("change", updateCashStack);

	updateCashStack(false);
};
