import { calculateNetWorth } from "./finance-engine.js"
import { loadData } from "./storage-engine.js"

function init(){

const accounts = loadData("accounts")

const netWorth = calculateNetWorth(accounts)

console.log("Net Worth:", netWorth)

}

document.addEventListener("DOMContentLoaded", init)
