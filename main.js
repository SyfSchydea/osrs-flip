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

// Cache of volume data from /1h, /5m, etc.
let itemVolumes = null;

// Amount of money the user is currently willing to invest.
// Updated by the input on the page.
let userCashStack = null;

// How long the user is willing to wait for transactions to complete
let userFlipPeriod = null;

// Constants about how much data to consider for trading volume
const VOLUME_PERIOD_API_CALL = "24h";
const VOLUME_PERIOD_HOURS = 24;

const pageLimit = 50;

// Add a table cell to a table row.
function addCell(row, contents, link=null) {
	if (typeof contents == "number") {
		contents = contents.toLocaleString();
	}

	let cell = document.createElement("td");

	if (link != null) {
		let a = document.createElement("a");
		a.href = link;
		a.textContent = contents;
		cell.appendChild(a);
	} else {
		cell.textContent = contents;
	}

	row.appendChild(cell);
}

// Recalculate profits, and repopulate the table
function populateTable() {
	if (itemPrices == null || itemVolumes == null || mappingData == null) {
		return;
	}

	let cashStack = userCashStack;
	if (cashStack == null) {
		cashStack = 2147483647;
	}

	let period = userFlipPeriod;
	if (!period) {
		period = 4;
	}

	// Calculate stats for each item
	for (let item of mappingData) {
		let itemPriceData = itemPrices[item.id];
		let volumes = itemVolumes[item.id];
		if (!itemPriceData || !volumes) {
			continue;
		}

		itemPriceData.mapping = item;

		itemPriceData.margin = itemPriceData.avgHighPrice - itemPriceData.avgLowPrice;

		let cashStackLimit = cashStack / itemPriceData.avgLowPrice;
		let buyLimit = item.limit;
		let lowVolumeLimit  = volumes.lowPriceVolume  / VOLUME_PERIOD_HOURS * period;
		let highVolumeLimit = volumes.highPriceVolume / VOLUME_PERIOD_HOURS * period;

		let flipQty = Math.min(cashStackLimit, buyLimit, lowVolumeLimit, highVolumeLimit);
		itemPriceData.limitingFactor =
			flipQty == cashStackLimit?  "Cash Stack" :
			flipQty == buyLimit?        "GE Buy Limit" :
			flipQty == lowVolumeLimit?  "Low Price Volume" :
			                            "High Price Volume";

		itemPriceData.maxQuantity = Math.floor(flipQty);

		itemPriceData.potentialProfit = itemPriceData.margin * itemPriceData.maxQuantity;
	}

	// Sort items by profit
	let itemEntries = Object.entries(itemPrices);
	itemEntries.sort((a, b) => b[1].potentialProfit - a[1].potentialProfit);

	// Clear and repopulate table
	let table = document.querySelector("#results tbody");
	table.innerHTML = "";

	let rowsAdded = 0;
	for (let [id, itemPriceData] of itemEntries) {
		let item = itemPriceData.mapping;
		let volumes = itemVolumes[id];

		// Skip items with missing data
		if (!itemPriceData.avgLowPrice || !itemPriceData.avgHighPrice || !volumes) {
			continue;
		}

		// Skip items which don't profit
		if (itemPriceData.margin <= 0) {
			continue;
		}

		// Skip items which we can't afford to buy any of
		if (itemPriceData.maxQuantity == 0) {
			continue;
		}

		let row = document.createElement("tr");
		addCell(row, item.name, "https://prices.runescape.wiki/osrs/item/" + item.id);
		addCell(row, item.limit);
		addCell(row, itemPriceData.avgLowPrice);
		addCell(row, itemPriceData.avgHighPrice);
		addCell(row, itemPriceData.margin);
		addCell(row, volumes.lowPriceVolume);
		addCell(row, volumes.highPriceVolume);
		addCell(row, itemPriceData.maxQuantity);
		addCell(row, itemPriceData.limitingFactor);
		addCell(row, itemPriceData.potentialProfit);

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

// Parse an amount string
// Allows k, m, and b to be used
// eg 5k -> 5000
//    2m -> 2000000
//    1.2b -> 1200000000
function parseAmount(amtText) {
	let match = amtText.match(/^(\d*(?:\.\d*)?)([kmb]+)$/i);
	if (!match) {
		return null;
	}

	let amt = +match[1];
	if (isNaN(amt)) {
		return null;
	}

	for (let c of match[2]) {
		switch (c) {
			case "k":
			case "K":
				amt *= 1000;
				break;

			case "m":
			case "M":
				amt *= 1e6;
				break;

			case "b":
			case "B":
				amt *= 1e9;
				break;
		}
	}

	return amt;
}

function updateCashStack(tableUpdate=true) {
	let cashstackInput = document.querySelector("#user-cash");
	let amt = parseAmount(cashstackInput.value);
	if (amt == null) {
		return;
	}

	userCashStack = amt;
	if (tableUpdate) {
		populateTable();
	}
}

function updateFlipPeriod(tableUpdate=true) {
	let flipPeriodInput = document.querySelector("#flip-period");
	let period = +flipPeriodInput.value;
	if (isNaN(period)) {
		return;
	}

	userFlipPeriod = period;
	if (tableUpdate) {
		populateTable();
	}
}

fetchApi(VOLUME_PERIOD_API_CALL, data => {
	itemVolumes = data.data;
	populateTable();
});
fetchApi("mapping", data => {
	mappingData = data;
	updatePrices();
});


window.onload = () => {
	let cashstackInput = document.querySelector("#user-cash");
	cashstackInput.addEventListener("change", updateCashStack.bind(null, true));

	let flipPeriodInput = document.querySelector("#flip-period");
	flipPeriodInput.addEventListener("change", updateFlipPeriod.bind(null, true));

	updateCashStack(false);
	updateFlipPeriod(false);
};
