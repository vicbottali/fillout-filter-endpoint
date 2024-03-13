import express, { Request, Response } from 'express';
import axios from 'axios';
import { matchedData, query, ValidationChain, validationResult } from 'express-validator';
import * as dotenv from 'dotenv';

dotenv.config();

const app = express();
//app.use(express.json());
const { PORT, FILLOUT_BASE_URL, API_KEY, FORM_ID } = process.env;
const filloutApi = axios.create({
    baseURL: FILLOUT_BASE_URL,
    headers: { 'Authorization': `Bearer ${API_KEY}` }
});

const queryParamValidators = (): ValidationChain[] =>
    [
        query('limit')
            .default(150)
            .isInt({ min: 1, max: 150 }),
        query('afterDate')
            .isDate()
            .optional(),
        query('beforeDate')
            .isDate()
            .optional(),
        query('offset')
            .default(0)
            .isInt(),
        query('status')
            .default('finished')
            .isIn(['in_progress', 'finished']),
        query('includeEditLink')
            .default(false)
            .isBoolean()
            .optional(),
        query('sort')
            .default('asc')
            .isIn(['asc', 'desc']),
        query('filters')
            .isJSON()
            .optional()
    ];

app.get('/:formId/filteredResponses', queryParamValidators(), (req: Request, res: Response) => {
    const { formId } = req.params;
    const validated = validationResult(req);
    if (!validated.isEmpty()) return res.status(404).json({ message: 'Invalid Query Parameters' });

    const { filters = null, ...filloutParams } = matchedData(req);
   
    filloutApi.get(
        `/api/forms/${formId}/submissions`,
        { params: filloutParams }
    )
        .then(({ data }) => {
            try {
                const filteredResponses = filterResponse(data.responses, filtersToMap(filters));
                res.json({
                    responses: filteredResponses,
                    totalResponses: filteredResponses.length,
                    pageCount: Math.ceil(filteredResponses.length / filloutParams.limit)
            });
            } catch (error) {
                res.status(400).json({message: error});
            }
        })
        .catch(error => {
            return res.status(400).json({ message: 'Error while calling Fillout API' });
        });

});

app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
});



const filterResponse = (responses: any, filters: Map<string, FilterClauseType & {filterValType : FilterValueType}>) => {
    const filterResponses = [];
    for (let submission of responses) {
        let includeSubmission: boolean = true;
        let { questions } = submission;
        
        for (const [key, value] of filters) {
            const question = questions.find(({ id }: {id: string}) => id === key);

            // if the submission doesn't have this question (e.g partial submissions), it won't be included
            if (!question) {
                includeSubmission = false;
                break;
            }

            const { value: questionVal } = question;
            const { value: filterVal, condition, filterValType } = value;

            // if we're looking (or not) for nulls specifically
            if (filterValType === 'null') {
                if (condition === 'greater_than' || condition === 'less_than') {
                    throw new InvalidFilterFormatError(`If you'd like to filter on null values, please use equals or does_not_equal`);
                }

                includeSubmission = (condition === 'equals' && questionVal === null) || (condition === 'does_not_equal' && questionVal !== null);  // otherwise it's does_not_equal

            }
            else if (questionVal === null) {
                includeSubmission = false;
                break;
            } else {
                switch (filterValType) {
                    case 'string':
                        includeSubmission = stringComparisonFn(filterVal as string, questionVal, condition);
                        break;
                    case 'date':
                        includeSubmission = dateComparisonFn(filterVal as string, questionVal, condition);
                        break;
                    case 'number':
                        includeSubmission = numberComparisonFn(filterVal as number, questionVal, condition);
                        break;
                }
            }

            if (!includeSubmission) break;
        }

        if (includeSubmission) {
            filterResponses.push(submission);
        }
    }

    return filterResponses;
}


const stringComparisonFn = (filterVal: string, questionVal: string, condition: FilterConditionType) => {
    filterVal = filterVal.toLowerCase();
    questionVal = questionVal.toLowerCase();
    // A little broader for strings, if it includes the same text, it'll return. It's also case-insensitive
    // Maybe could add additional params like 'matchExact' or something to that effect
    if (condition === 'equals') {
        return questionVal.includes(filterVal);
    } else if (condition === 'does_not_equal') {
        return !questionVal.includes(filterVal);
    }
    else {
        // Otherwise it's greater or less than, doesn't work so well for comparing strings.
        throw new InvalidFilterFormatError(`Cannot filter strings with greater_than or less_than. Please use equals or does_not_equals.`);
    }
}

const numberComparisonFn = (filterVal: number, questionVal: number, condition: FilterConditionType, isRange = false) => {
    if (condition === 'equals') {
        return questionVal === filterVal;
    }
    else if (condition === 'does_not_equal') {
        return questionVal !== filterVal;
    }
    else if (condition === 'greater_than') {
        return questionVal > filterVal;
    }
    else {
       return questionVal < filterVal;
    }
}


const dateComparisonFn = (filterVal: string, questionVal: string, condition: FilterConditionType, isRange = false) => {
    if (!isDateStr(questionVal)) return false;

    return numberComparisonFn(Date.parse(filterVal as string).valueOf(), Date.parse(questionVal).valueOf(), condition);
}

const filtersToMap = (filters: ResponseFiltersType) => {
    const filterMap = new Map();

    for (let { id, condition, value } of filters) {
        if (!filterMap.has(id)) {
            let filterValType: any = typeof value;
            if (value === null) {
                filterValType = 'null';
            }

            if (!(filterValType === 'number' || filterValType === 'string' || filterValType === 'null')) {
                throw new InvalidFilterFormatError('Filter values must be a number, string, date, or null.');
            }

            // Since dates will be passed in as strings, we'll check for that here
            if (filterValType === 'string' && isDateStr(value)) {
                filterValType = 'date';
            }

            filterMap.set(id, { condition, filterValType, value });
        } else {
            throw new InvalidFilterFormatError('Too many conditions for a single Id');
        }
    }

    return filterMap;
}

// Should suffice if it's in ISO Date format
const isDateStr = (dateStr: any) => {
    const date = Date.parse(dateStr as string);
    return !isNaN(date);
}



type FilterValueType = 'string' | 'number' | 'date' | 'null';

type FilterConditionType = 'equals' | 'does_not_equal' | 'greater_than' | 'less_than';

type FilterClauseType = {
    id: string;
    condition: FilterConditionType;
    value: number | string | null;
}

type ResponseFiltersType = FilterClauseType[];


class InvalidFilterFormatError extends Error { 
    constructor(msg: string) {
        super(msg);
        this.name = InvalidFilterFormatError.name;
    }
};