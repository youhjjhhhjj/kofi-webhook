const http = require('http');
const pg = require('pg');
const qs = require('querystring');

const DATABASE_URL = process.env.DATABASE_URL || require('./secrets/database-url.json');
const WEBHOOK_TOKEN = process.env.WEBHOOK_TOKEN || require('./secrets/webhook-token.json');
const DONATION_URL = process.env.DONATION_URL || require('./secrets/donation-url.json');
const PORT = process.env.PORT || 4837;


const pgClient = new pg.Pool({
    connectionString: DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});


http.createServer(async function (request, response) {
    // CREATE TABLE kofi.payment_type ( payment_type_id CHAR(1) PRIMARY KEY, description VARCHAR(255) );
    // CREATE TABLE kofi.product ( product_id VARCHAR(10) PRIMARY KEY, description VARCHAR(255), price DECIMAL(9,2) );
    // CREATE TABLE kofi.payment ( payment_id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY, create_time TIMESTAMP, username VARCHAR(255), email VARCHAR(255), payment_type_id CHAR(1) REFERENCES kofi.payment_type (payment_type_id), amount DECIMAL(9,2), note VARCHAR(255) );
    // CREATE TABLE kofi.order ( payment_id INTEGER REFERENCES kofi.payment (payment_id), product_id VARCHAR(10) REFERENCES kofi.product (product_id) );
    try {
        if (request.method != 'POST') {
            response.writeHead(405);
            response.end();
            return false;
        }
        let data = [];
        request.on('data', (d) => {
            data.push(d);
        });
        request.on('end', async function() {
            jsonData = JSON.parse(qs.parse(Buffer.concat(data).toString()).data);
            console.log(jsonData);
            if (jsonData.verification_token != WEBHOOK_TOKEN) {
                console.log('Authentication failure');
                response.writeHead(401);
                response.end();
                return;
            }
            const email = jsonData.email.toLowerCase()
            // let query_result = await pgClient.query(`INSERT INTO Kofi.Payment ( create_time, username, email, payment_type_id, amount ) VALUES ( '${jsonData.timestamp}', '${jsonData.from_name}', '${email}', '${jsonData.type.split(' ').at(-1).charAt(0)}', ${parseFloat(jsonData.amount)} ) RETURNING payment_id`);
            let query_result = await pgClient.query('INSERT INTO Kofi.Payment ( create_time, username, email, payment_type_id, amount ) VALUES ( $1, $2, $3, $4, $5 ) RETURNING payment_id ;', [jsonData.timestamp, jsonData.from_name, email, jsonData.type.split(' ').at(-1).charAt(0), parseFloat(jsonData.amount)]);
            if (jsonData.type == 'Shop Order') {
                let payment_id = query_result.rows[0].payment_id;
                const insertValues = [];
                for (const product of jsonData.shop_items) {
                    for (let i = 0; i < product.quantity; i++) {
                        insertValues.push(`( ${payment_id}, '${product.direct_link_code}' )`);
                    }
                };
                pgClient.query(`INSERT INTO Kofi.Order ( payment_id, product_id ) VALUES ${insertValues.join(',')}`)
            }
            else if (jsonData.type == 'Donation') {
                const postData = JSON.stringify({
                    'email': email,
                    'amount': jsonData.amount
                });
                const options = {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json', 'Content-Length': postData.length}
                };
                var req = http.request(DONATION_URL, options);
                req.on('error', (e) => console.error(e));
                req.write(postData);
                req.end();
            }
            response.writeHead(200);
            response.end();
        });
    }
    catch (error) {
        console.error(error.stack);
        response.writeHead(500);
        response.end();
    }
}).listen(PORT);
console.log(`Server running on ${PORT}`);
