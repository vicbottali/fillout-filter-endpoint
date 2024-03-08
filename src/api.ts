import express from 'express';
import axios from 'axios';
import * as dotenv from 'dotenv';

dotenv.config();

const app = express();
const { PORT, FILLOUT_BASE_URL, API_KEY, FORM_ID } = process.env;
const filloutApi = axios.create({
    baseURL: FILLOUT_BASE_URL,
    headers: { 'Authorization': `Bearer ${API_KEY}` }
});

app.get('/', (req, res) => {
    filloutApi.get(
        `/api/forms/${FORM_ID}/submissions`
    ).then(({ data }) => {
        console.log(data);
        res.json(data);
    })
    
});

app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
});