'use strict';

// read env vars from .env file
require('dotenv').config();
const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');
const { google } = require('googleapis');
const keys = require('./keys.json');
const moment = require('moment');
const PLAID_CLIENT_ID = process.env.PLAID_CLIENT_ID;
const PLAID_SECRET = process.env.PLAID_SECRET;
const PLAID_ENV = process.env.PLAID_ENV || 'sandbox';
const PLAID_ACCOUNT = process.env.PLAID_ACCOUNT;
const ACTIVE_SHEET = process.env.ACTIVE_SHEET;

const configuration = new Configuration({
  basePath: PlaidEnvironments[PLAID_ENV],
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': PLAID_CLIENT_ID,
      'PLAID-SECRET': PLAID_SECRET,
      'Plaid-Version': '2020-09-14',
    },
  },
});

const client = new PlaidApi(configuration);

const googleClient = new google.auth.JWT(
  keys.client_email,
  null,
  keys.private_key,
  ['https://www.googleapis.com/auth/spreadsheets']
);

module.exports.updateSheet = () => {
  googleClient.authorize(async (err, _) => {
    if (err) {
      console.log(err);
      return;
    } else {
      getLastRow(googleClient);
    }
  });
};

async function getLastRow(client) {
  const sheets = google.sheets({ version: 'v4' });
  const values = [];
  const resource = {
    values
  };
  const options = {
    spreadsheetId: ACTIVE_SHEET,
    range: 'A:L',
    resource,
    valueInputOption: 'RAW',
    auth: client
  };
  sheets.spreadsheets.values.append(options, (err, res) => {
    if (err) {
      console.log(err);
      return null;
    }
    const range = res.data.tableRange;
    const rowNum = parseInt(range.replace(/.*!\w+\d+:(\w+?)(\d+)/, '$2'));
    const readOptions = {
      spreadsheetId: ACTIVE_SHEET,
      range: `A${rowNum}:L${rowNum}`,
      auth: client
    };
    sheets.spreadsheets.values.get(readOptions, async (err, res) => {
      if (err) {
        console.log(err);
        return;
      }
      const lastId = res.data.values[0][11];
      const transactions = await getLastWeekTransactions(lastId);
      // console.log(transactions);
      writeSheet(client, transactions);
    });
  });
}

async function writeSheet(client, newTransactions) {
  const sheets = google.sheets({ version: 'v4' });
  const values = newTransactions;
  const resource = { values };
  const options = {
    spreadsheetId: ACTIVE_SHEET,
    range: 'A:L',
    resource,
    valueInputOption: 'RAW',
    auth: client
  };
  sheets.spreadsheets.values.append(options);
}

async function getLastWeekTransactions(lastId) {
  const accessToken = PLAID_ACCOUNT;
  const startDate = moment().subtract(15, 'day').format('YYYY-MM-DD');
  const endDate = moment().format('YYYY-MM-DD');
  const configs = {
    access_token: accessToken,
    start_date: startDate,
    end_date: endDate,
    options: {
      count: 500,
      offset: 0,
    },
  };
  try {
    const transactionsResponse = await client.transactionsGet(configs);
    const accountsResponse = await client.accountsGet({ access_token: accessToken });
    const accounts = accountsResponse.data.accounts;
    let accountsMap = {};
    accounts.forEach((a) => {
      accountsMap[a.account_id] = a.name;
    });

    const transactions = transactionsResponse.data.transactions.filter(t => !t.pending);
    let lastIndex = transactions.findIndex(trans => trans.transaction_id == lastId);
    if (lastIndex == -1) {
      lastIndex = transactions.length;
    }
    const listTransactions = transactions.slice(0, lastIndex).map(t => [
      accountsMap[t.account_id],
      t.date.substring(0, 4),
      t.date.substring(5, 7),
      t.date,
      t.name,
      t.merchant_name || "",
      t.location.city || "",
      t.amount,
      t.amount < 0 ? "In" : "Out",
      t.category.join(', '),
      t.authorized_date || "",
      t.transaction_id
    ]);
    return listTransactions.reverse();
  } catch (error) {
    console.log(error);
  }
}

module.exports.updateSheet();