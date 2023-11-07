const express = require("express");
require('dotenv').config();
const cors = require("cors");
const bodyParser = require('body-parser')
const app = express();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

app.use(cors());

app.use(express.static("public"));
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: false }))
app.use(bodyParser.json())

const sequraData = (req) => {
    return {
        order: {
            state: null,
            merchant: {
                id: process.env.SEQURA_MERCHANT_ID,
                notify_url: process.env.SEQURA_NOTIFY_URL,
                notification_parameters: {},
                return_url: process.env.SEQURA_RETURN_URL,
                abort_url: process.env.SEQURA_ABORT_URL,
                options: {
                    has_jquery: true
                },
                events_webhook: {
                    url: process.env.SEQURA_WEBHOOK_URL,
                },
            },
            cart: {
                currency: "EUR",
                gift: false,
                order_total_with_tax: parseFloat(req.body.score.replace(',', '.')) * 100,
                items: [{
                    reference: req.body.product_id,
                    name: req.body.product_name,
                    price_with_tax: parseFloat(req.body.score.replace(',', '.')) * 100,
                    quantity: 1,
                    total_with_tax: parseFloat(req.body.score.replace(',', '.')) * 100,
                    downloadable: false
                }]
            },
            delivery_method: {
                name: "default"
            },
            delivery_address: {
                given_names: req.body.client_name,
                surnames: req.body.client_surname,
                company: "",
                address_line_1: req.body.client_address_line1,
                address_line_2: req.body.client_address_line2,
                postal_code: req.body.client_postal_code,
                city: req.body.client_city,
                country_code: req.body.client_country_code

            },
            invoice_address: {
                given_names: req.body.client_name,
                surnames: req.body.client_surname,
                company: "",
                address_line_1: req.body.client_address_line1,
                address_line_2: req.body.client_address_line2,
                postal_code: req.body.client_postal_code,
                city: req.body.client_city,
                country_code: req.body.client_country_code
            },
            customer: {
                given_names: req.body.client_name,
                surnames: req.body.client_surname,
                email: req.body.client_email,
                logged_in: "unknown",
                language_code: "es-ES"
            },
            gui: {
                layout: req.body.layout || "desktop"
            },
            platform: {
                name: "",
                version: "",
                uname: "",
                db_name: "",
                db_version: "",
            }
        }
    }
}

function getCurrentDateTimeString() {
    const now = new Date();
    const year = now.getUTCFullYear().toString().slice(-2); // Get last 2 digits of the year
    const month = (now.getUTCMonth() + 1).toString().padStart(2, "0"); // Months are 0-11, hence the +1
    const day = now.getUTCDate().toString().padStart(2, "0");
    const hours = now.getUTCHours().toString().padStart(2, "0");
    const minutes = now.getUTCMinutes().toString().padStart(2, "0");
    const seconds = now.getUTCSeconds().toString().padStart(2, "0");

    return year + month + day + hours + minutes + seconds;
}

app.post("/create-payment-intent", async (req, res) => {
    const { amount } = req.body;

    // Create a PaymentIntent with the order amount and currency
    const paymentIntent = await stripe.paymentIntents.create({
        amount,
        currency: "eur",
        automatic_payment_methods: {
            enabled: true,
        },
    });

    res.send({
        clientSecret: paymentIntent.client_secret,
    });
});

app.post("/sequra-form", async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', '*');
    let data = {};
    try {
        data = sequraData(req);
        const ip = req.headers['x-forwarded-for'] || req.ip;
        const userAgent = req.headers['user-agent'];
        data.order.customer = {
            ...data.order.customer,
            ip_number: ip,
            user_agent: userAgent
        };

        data.order.merchant.notification_parameters = {
            product_id: req.body.product_id,
            product_name: req.body.product_name,
            product_reference: getCurrentDateTimeString(),
            score: req.body.score,
            client_name: req.body.client_name,
            client_surname: req.body.client_surname,
            client_email: req.body.client_email,
            client_address_line1: req.body.client_address_line1,
            client_address_line2: req.body.client_address_line2,
            client_postal_code: req.body.client_postal_code,
            client_city: req.body.client_city,
            client_country_code: req.body.client_country_code,
            layout: req.body.layout,
            ip_number: ip,
            user_agent: userAgent
        }
    } catch (error) {
        res.status(500).send({ error: error.message });
    }

    try {
        const postResponse = await fetch('https://sandbox.sequrapi.com/orders', {
            method: 'POST',
            body: JSON.stringify(data),
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Basic ' + Buffer.from(
                    `${process.env.SEQURA_USER}:${process.env.SEQURA_PASSWORD}`
                ).toString('base64')
            }
        });

        // Check for successful post
        if (!postResponse.ok) {
            console.error(postResponse)
            throw new Error('Failed to post to Sequra API: ' + postResponse.statusText);
        }

        // Fetch the Location header URL
        const locationUrl = postResponse.headers.get('Location');
        if (!locationUrl) {
            throw new Error('Location header not found in Sequra API response');
        }

        const getResponse = await fetch(locationUrl + "/form_v2?product=pp3", {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Basic ' + Buffer.from(
                    `${process.env.SEQURA_USER}:${process.env.SEQURA_PASSWORD}`
                ).toString('base64')
            }
        });
        if (!getResponse.ok) {
            throw new Error('Failed to fetch from Sequra API location URL: ' + getResponse.statusText);
        }

        const htmlContent = await getResponse.text();

        // Return the HTML to the requester
        res.send(htmlContent);

    } catch (error) {
        res.status(500).send({ error: error.message });
    }
});

app.post("/sequra-confirm-payment", async (req, res) => {
    res.status(200).send();
    const data = sequraData(req);

    data.order.merchant_reference = { order_ref_1: req.body.product_reference };

    data.order.customer = {
        ...data.order.customer,
        ip_number: req.body.ip_number,
        user_agent: req.body.user_agent
    };

    if (req.body.sq_state === "approved" || req.body.sq_state === "needs_review") {
        data.order.state = req.body.sq_state === "approved" ? "confirmed" : "on_hold";
        try {
            const putResponse = await fetch(`https://sandbox.sequrapi.com/orders/${req.body.order_ref}`, {
                method: 'PUT',
                body: JSON.stringify(data),
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Basic ' + Buffer.from(
                        `${process.env.SEQURA_USER}:${process.env.SEQURA_PASSWORD}`
                    ).toString('base64')
                }
            });

            if (!putResponse.ok) {
                console.error(await putResponse.json());
                throw new Error('Failed to post to Sequra API: ' + putResponse.statusText);
            }
        } catch (error) {
            console.log(error.message);
        }
    }
});

app.post("/sequra-webhook", async (req, res) => {
    console.log(req.body);
    res.status(200).send();
});

app.listen(process.env.PORT || 4242);