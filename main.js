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

// Timestamps for when each dataset was updated
let priceDataUpdated = null;
let volumeDataUpdated = null;

// Amount of money the user is currently willing to invest.
// Updated by the input on the page.
let userCashStack = null;

// How long the user is willing to wait for transactions to complete
let userFlipPeriod = null;

// Constants about how much data to consider for trading volume
const VOLUME_PERIOD_API_CALL = "24h";
const VOLUME_PERIOD_HOURS = 24;

// How often should the auto-refresh trigger? (ms)
const AUTO_REFRESH_INTERVAL = 60 * 1000;

const pageLimit = 50;

// Add a table cell to a table row.
function addCell(row, contents, link=null, numeric=false) {
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

	if (numeric) {
		cell.classList.add("numeric");
	}

	row.appendChild(cell);
}

// Add a cell which holds a number of some kind
function addNumericCell(row, contents) {
	addCell(row, contents, null, true);
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

	// Number of 4-hour GE buy limit periods which will pass over the course of this flip
	let geLimitWindows = Math.ceil(period / 4);

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
		let buyLimit = item.limit * geLimitWindows;
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

		// Skip bonds since they can't be resold easily
		if (item.id == 13190) {
			continue;
		}

		let row = document.createElement("tr");
		addCell(row, item.name, "https://prices.runescape.wiki/osrs/item/" + item.id);
		addNumericCell(row, item.limit);
		addNumericCell(row, formatGp(itemPriceData.avgLowPrice));
		addNumericCell(row, formatGp(itemPriceData.avgHighPrice));
		addNumericCell(row, formatGp(itemPriceData.margin));
		addNumericCell(row, volumes.lowPriceVolume);
		addNumericCell(row, volumes.highPriceVolume);
		addNumericCell(row, itemPriceData.maxQuantity);
		addCell(row, itemPriceData.limitingFactor);
		addNumericCell(row, formatGp(itemPriceData.potentialProfit));

		table.appendChild(row);

		if (++rowsAdded >= pageLimit) {
			break;
		}
	}
}

// Fetch the api call being used for price data based on the option on the page.
function getPriceApiSource() {
	let pricePeriodInput = document.querySelector("#price-period");
	return pricePeriodInput.value;
}

// Show the player how old the data they're currently looking at is.
function updateDataAgeDisplay() {
	let display = document.querySelector("#price-data-age-display");
	let date = new Date(Math.max(priceDataUpdated, volumeDataUpdated));

	display.textContent = "Data updated " + date.toLocaleString();
}

// Update the table of items
function updatePrices() {
	let src = getPriceApiSource();
	fetchApi(src, data => {
		let itemList = data.data;

		for (let item of mappingData) {
			let itemPriceData = itemList[item.id];
			if (!itemPriceData) {
				continue;
			}

			itemPriceData.mapping = item;

			// /latest formats data slightly differently to 5m, 10m, etc.
			if (src == "latest") {
				itemPriceData.avgHighPrice = itemPriceData.high;
				itemPriceData.avgLowPrice  = itemPriceData.low;
			}
		}

		itemPrices = itemList;
		priceDataUpdated = +new Date();

		updateDataAgeDisplay();
		populateTable();
	});
}

// Update item trading volumes
function updateVolumes() {
	fetchApi(VOLUME_PERIOD_API_CALL, data => {
		itemVolumes = data.data;
		volumeDataUpdated = +new Date();

		updateDataAgeDisplay();
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

// Parse a string for a period of time.
// Returns time period as a number of hours
// eg. 1 for 1 hour
//    24 for 1 day
//     0.16666... for 10 minutes
function parsePeriod(text) {
	let match = text.match(/^\s*(\d*(?:\.\d*)?)\s*(\w*)\s*$/i);
	if (!match) {
		return null;
	}

	let num = +match[1];
	if (isNaN(num)) {
		return null;
	}

	switch (match[2].toLowerCase()) {
		case "d":
		case "day":
		case "days":
			num *= 24;

		case "":
		case "h":
		case "hr":
		case "hrs":
		case "hour":
		case "hours":
			break;

		case "m":
		case "min":
		case "mins":
		case "minute":
		case "minutes":
			num /= 60;
			break;

		case "s":
		case "sec":
		case "secs":
		case "second":
		case "seconds":
			num /= 60 * 60;
			break;

		default:
			return null;
	}

	return num;
}

/**
 * Convert a number of hours to a readable string.
 */
function periodToString(period) {
	if (period < 1) {
		return (period * 60) + " minutes";
	} else {
		return period + " hours";
	}
}

// Format an amount of gp
function formatGp(num) {
	return num.toLocaleString() + "gp";
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
	let period = parsePeriod(flipPeriodInput.value);
	if (period != null) {
		userFlipPeriod = period;
	}

	flipPeriodInput.value = periodToString(userFlipPeriod);

	if (period != null && tableUpdate) {
		populateTable();
	}
}

fetchApi("mapping", data => {
	mappingData = data;
	updatePrices();
});
updateVolumes();

// Update all data
function refreshData() {
	updatePrices();
	updateVolumes();
}

let autoRefreshTimeoutId = null;

// Called regularly to handle auto-updates
function autoRefreshTick() {
	autoRefreshTimeoutId = null;

	let autoRefreshToggle = document.querySelector("#auto-refresh-enable");
	if (!autoRefreshToggle.checked) {
		return;
	}

	if (document.visibilityState == "visible") {
		refreshData();
	}

	scheduleAutoRefresh();
}

// Schedule the next tick of the auto-refresh
function scheduleAutoRefresh() {
	if (autoRefreshTimeoutId == null) {
		autoRefreshTimeoutId = setTimeout(autoRefreshTick, AUTO_REFRESH_INTERVAL);
	}
}

// Start the auto-refresh if the checkbox is enabled, or disable it otherwise
function updateAutoRefresh() {
	let autoRefreshToggle = document.querySelector("#auto-refresh-enable");
	if (autoRefreshToggle.checked) {
		scheduleAutoRefresh();
	} else if (autoRefreshTimeoutId != null) {
		clearTimeout(autoRefreshTimeoutId);
		autoRefreshTimeoutId = null;
	}
}

window.onload = () => {
	let cashstackInput = document.querySelector("#user-cash");
	cashstackInput.addEventListener("change", updateCashStack.bind(null, true));

	let flipPeriodInput = document.querySelector("#flip-period");
	flipPeriodInput.addEventListener("change", updateFlipPeriod.bind(null, true));

	let refreshButton = document.querySelector("#refresh-button");
	refreshButton.addEventListener("click", refreshData);

	let pricePeriodInput = document.querySelector("#price-period");
	pricePeriodInput.addEventListener("change", updatePrices);

	let autoRefreshToggle = document.querySelector("#auto-refresh-enable");
	autoRefreshToggle.addEventListener("change", updateAutoRefresh);

	updateCashStack(false);
	updateFlipPeriod(false);
	updateAutoRefresh();
};
