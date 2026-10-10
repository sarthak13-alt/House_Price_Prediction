# House Price Prediction Using Data Mining
DWM mini project - pure HTML, CSS and JavaScript. No Python, server, libraries or internet needed.

## Run
1. Unzip the folder and double-click **index.html** (Chrome, Edge or Firefox).
2. Login. Default admin: `admin` / `Admin@123`. Others can use the **Register** tab.

## What it does
- **Compare All Algorithms** - trains 7 algorithms (Linear Regression, Decision Tree, KNN, Random Forest, Gradient Boosting, J48, Naive Bayes)
  on the *same dataset* and shows: the **best algorithm**, the **accuracy of every algorithm**, what affects the price in that dataset,
  detailed scores, head-to-head tables, and a table of accuracy on **each dataset** you compared.
- Price Prediction (exact price) and Price Category (Low / Medium / High) comparisons
- Predict a House - enter details, every model gives its price
- Dataset overview, Preprocessing (admin) and Analysis charts

## Login and roles
| | User | Admin |
|---|---|---|
| Register | anyone | needs secret code `DWM-ADMIN-2026` (change it in `js/auth.js`) |
| Sample data, Analysis, all comparisons, Predict | yes | yes |
| Upload CSV, Preprocessing | no | yes |
| Admin Panel: **how many people registered**, 7-day sign-up chart, latest registrations, all accounts (delete / make admin / reset password), comparison history, activity log | no | yes |

Passwords are saved as a salted SHA-256 hash in the browser's localStorage. This is a project-level login (no server), so it is not real security.
To reset all accounts and history, clear the site data for the page in your browser.

## How "accuracy" is measured
- **Accuracy** = % of unseen test houses (20%) placed in the correct price category. All 7 algorithms are scored this way
  (Linear Regression and Gradient Boosting predict a price that is converted into a category).
- **Price ±10%** = % of test houses whose predicted price is within 10% of the real price (algorithms that predict a price).
- The best algorithm is the one with the highest overall score (average of accuracy, precision, recall, F1).

## Files
`index.html` page · `css/style.css` theme · `js/auth.js` accounts · `js/auth_ui.js` login screen + admin panel · `js/data.js` CSV + preprocessing ·
`js/models.js` all algorithms from scratch · `js/compare.js` comparisons · `js/charts.js` canvas charts · `js/ui.js` pages · `data/` sample CSV.
