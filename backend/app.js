const fs = require('fs');
const AWS = require('aws-sdk');
const OpenAI = require("openai");
const dotenv = require('dotenv');
const axios = require('axios');
const cors = require("cors");
const express = require('express');
const multer = require('multer');
const db = require('./connection');

const Contract = require('./contractModel');
const ExtractedContract = require('./ExtractedContractModel')
const userModel = require('./userModel'); 

const app = express();
app.use(express.json());
dotenv.config();
app.use(cors());

const path = require("path");
app.use(express.static(path.join(__dirname,"public")));

const tableCsv = "someval";
let lines = "someval";

// Display information about a block
function displayBlockInfo(block) {
    console.log("Block Id: " + block.Id);
    console.log("Type: " + block.BlockType);
    if ('EntityTypes' in block) {
        console.log('EntityTypes: ' + JSON.stringify(block.EntityTypes));
    }

    if ('Text' in block) {
        console.log("Text: " + block.Text);
    }

    if (block.BlockType !== 'PAGE') {
        console.log("Confidence: " + (block.Confidence ? block.Confidence.toFixed(2) + "%" : "N/A"));
    }

    console.log();
}

// Generate CSV representation of tables detected in the document
function getTableCsvResults(blocks) {
  console.log(blocks);

  const blocksMap = {};
  const tableBlocks = [];
  for (const block of blocks) {
      blocksMap[block.Id] = block;
      if (block.BlockType === "TABLE") {
          tableBlocks.push(block);
      }
  }

  if (tableBlocks.length <= 0) {
      return "<b> NO Table FOUND </b>";
  }

  let csv = '';
  for (let index = 0; index < tableBlocks.length; index++) {
      const tableResult = tableBlocks[index];
      csv += generateTableCsv(tableResult, blocksMap, index + 1);
      csv += '\n\n';
  }

  return csv;
}

// Generate CSV representation for a table
function generateTableCsv(tableResult, blocksMap, tableIndex) {
  const rows = getRowsColumnsMap(tableResult, blocksMap);

  const tableId = 'Table_' + tableIndex;

  let csv = 'Table: ' + tableId + '\n\n';

  for (const [rowIndex, cols] of Object.entries(rows)) {
      for (const [colIndex, text] of Object.entries(cols)) {
          csv += text + ",";
      }
      csv += '\n';
  }

  csv += '\n\n\n';
  return csv;
}

// Map rows and columns of a table
function getRowsColumnsMap(tableResult, blocksMap) {
  const rows = {};
  for (const relationship of tableResult.Relationships) {
      if (relationship.Type === 'CHILD') {
          for (const childId of relationship.Ids) {
              try {
                  const cell = blocksMap[childId];
                  if (cell.BlockType === 'CELL') {
                      const rowIndex = cell.RowIndex;
                      const colIndex = cell.ColumnIndex;
                      if (!rows[rowIndex]) {
                          rows[rowIndex] = {};
                      }
                      rows[rowIndex][colIndex] = getText(cell, blocksMap);
                  }
              } catch (error) {
                  console.error("Error extracting Table data:", error);
              }
          }
      }
  }
  return rows;
}

// Get text from a block
function getText(result, blocksMap) {
  let text = '';
  if ('Relationships' in result) {
      for (const relationship of result.Relationships) {
          if (relationship.Type === 'CHILD') {
              for (const childId of relationship.Ids) {
                  try {
                      const word = blocksMap[childId];
                      if (word.BlockType === 'WORD') {
                          text += word.Text + ' ';
                      }
                      if (word.BlockType === 'SELECTION_ELEMENT' && word.SelectionStatus === 'SELECTED') {
                          text += 'X ';
                      }
                  } catch (error) {
                      console.error("Error extracting Table data:", error);
                  }
              }
          }
      }
  }
  return text;
}

// Start document analysis job
function startJob(client, s3BucketName, objectName) {
    return new Promise((resolve, reject) => {
        client.startDocumentAnalysis({
            DocumentLocation: { S3Object: { Bucket: s3BucketName, Name: objectName } },
            FeatureTypes: ["TABLES"]
        }, (err, data) => {
            if (err) reject(err);
            else resolve(data.JobId);
        });
    });
}

// Check if document analysis job is complete
function isJobComplete(client, jobId) {
    return new Promise((resolve, reject) => {
        function checkJobStatus() {
            client.getDocumentAnalysis({ JobId: jobId }, (err, data) => {
                if (err) reject(err);
                else {
                    console.log("Job status: " + data.JobStatus);
                    if (data.JobStatus === "IN_PROGRESS") {
                        setTimeout(checkJobStatus, 1000);
                    } else {
                        resolve(data);
                    }
                }
            });
        }
        checkJobStatus();
    });
}

// Get document analysis job results
function getJobResults(client, jobId) {
    return new Promise((resolve, reject) => {
        const pages = [];
        function getResults(nextToken) {
            client.getDocumentAnalysis({ JobId: jobId, NextToken: nextToken }, (err, data) => {
                if (err) reject(err);
                else {
                    pages.push(data);
                    console.log("Resultset page received: " + pages.length);
                    if (data.NextToken) {
                        setTimeout(() => getResults(data.NextToken), 1000);
                    } else {
                        resolve(pages);
                    }
                }
            });
        }
        getResults(null);
    });
}

async function extract_text_from_pdf(pdfFile) {
    const s3BucketName = "textextractbucket1";
    const s3Client = new AWS.S3({
        accessKeyId: process.env.TEXTRACT_ACCESS_KEY,
        secretAccessKey: process.env.TEXTRACT_SECRET_ACCESS_KEY
    });
    try {
        await s3Client.upload({ Bucket: s3BucketName, Key: pdfFile, Body: fs.createReadStream(pdfFile) }).promise();
    } catch (error) {
        console.error("Error uploading file to S3:", error);
        return;
    }

    const textractClient = new AWS.Textract({
        region: process.env.TEXTRACT_REGION,
        accessKeyId: process.env.TEXTRACT_ACCESS_KEY,
        secretAccessKey: process.env.TEXTRACT_SECRET_ACCESS_KEY
    });

    const jobId = await startJob(textractClient, s3BucketName, pdfFile);
    console.log("Started job with id: " + jobId);
    const jobResult = await isJobComplete(textractClient, jobId);
    const response = await getJobResults(textractClient, jobId);

    if (fs.existsSync('tables.csv')) fs.unlinkSync('tables.csv');
    if (fs.existsSync('temp.txt')) fs.unlinkSync('temp.txt');

    for (const resultPage of response) {
        const blocks = resultPage.Blocks;
        const tableCsv = getTableCsvResults(blocks);
        const outputFileName = "tables.csv";
        fs.appendFileSync(outputFileName, tableCsv);
        //console.log('Detected Document Text');
        //console.log('Pages: ' + resultPage.DocumentMetadata.Pages);
        //console.log('OUTPUT TO CSV FILE: ' + outputFileName);
        for (const block of blocks) {
            displayBlockInfo(block);
            //console.log();
        }
    }

    lines = [];
    for (const resultPage of response) {
        for (const item of resultPage.Blocks) {
            if (item.BlockType === "LINE") {
                //console.log(item.Text);
                lines.push(item.Text);
            }
        }
    }
    lines = lines.join('\n');
    fs.writeFileSync('temp.txt', lines);
}
//const promp = "Please analyze the following high school transcript text and the associated table data to extract the student's name, date of birth, GPA, and course grades with credits. Format the extracted information as JSON key-value pairs. Ensure that the extracted data is accurate and neatly organized for each course listed";


const openai = new OpenAI({
  apiKey: process.env.OPEN_AI_KEY
});
// Function to make a request to OpenAI API
async function extract_results(prompt) {

  const lines = fs.readFileSync('temp.txt', 'utf8');
  const tableCsv = fs.readFileSync('tables.csv', 'utf8');

  const formattedPrompt = `
  Use the following data

  Raw Text data: ${lines}

  CSV Table data: ${tableCsv}

  Extract the data as per the following requirements and represent in JSON format:
  ${prompt}

  Most Importantly, The output data should be strictly in JSON format only.
  `;

  console.log(formattedPrompt)
  try {
    const response = await openai.chat.completions.create({
      messages:[
                
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": formattedPrompt},
    
],
      model: "gpt-3.5-turbo-0125",
      max_tokens: 2048,
      temperature: 0,
      response_format:{"type": "json_object"},
    });
  
    const res = response.choices[0].message.content;
    return res;
  } catch (error) {
    console.error('Error:', error);
    return null;
  }
}


const storage = multer.diskStorage({
  destination: function (req, file, cb) {
      cb(null, 'uploads/') // specify the directory where uploaded files will be stored
  },
  filename: function (req, file, cb) {
      cb(null, file.originalname) // use the original file name for storing
  }
});

const upload = multer({ storage: storage });

  app.post('/api/contract', async (req, res) => {
    try {
        const { name, prompt, description } = req.body;
        const newContract = new Contract({ name, prompt, description });
        await newContract.save();
        res.json({ message: 'Contract created successfully', newContract });
    } catch (error) {
        console.error('Error adding contract item:', error.message);
        res.status(500).json({ error: 'Failed to add contract item' });
    }
});

  app.get('/api/contract', async (req, res) => {
    try {
      const items = await Contract.find();
      res.json(items);
    } catch (error) {
      console.error('Error fetching inventory items:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  app.put('/api/contract/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const { name, prompt, description } = req.body;
      await Contract.findByIdAndUpdate(id, { name, prompt, description });
      res.status(200).json({ message: 'contract item updated successfully' });
    } catch (error) {
      console.error('Error updating contract item:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }); 

  app.put('/api/update-profile', async (req, res) => {
    const { firstName, lastName, email } = req.body;

  try {
    const user = await userModel.findOne({ email });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    user.firstName = firstName;
    user.lastName = lastName;
    await user.save();
    return res.status(200).json({ message: 'User profile updated successfully', userInfo:user });
  } catch (error) {
    console.error('Error updating user profile:', error);
    return res.status(500).json({ error: 'Failed to update user profile' });
  }
  }); 
  
  app.delete('/api/contract/:id', async (req, res) => {
    try {
      const { id } = req.params;
      await Contract.findByIdAndDelete(id);
      res.status(200).json({ message: 'contract item deleted successfully' });
    } catch (error) {
      console.error('Error deleting contract item:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  app.post('/api/login', async (req, res) => {
    const { userNameorEmail, password } = req.body;
    try {
      
      const user = await userModel.findOne({ $or: [{ userName: userNameorEmail }, { email: userNameorEmail }] });
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }
      if (user.password !== password) {
        return res.status(401).json({ message: 'Incorrect password' });
      }
      console.log(user);
      return res.status(200).json({ message: 'Login successful', userInfo:user});
    } catch (error) {
      console.error('Error logging in:', error);
      return res.status(500).json({ message: 'Internal server error' });
    }
  });

  app.post('/api/signup',async (req,res)=>{
    try{
    const { firstName, lastName,userName,email,password } = req.body;
    const users = await userModel.find({ $or: [{ userName: userName }, { email: email }] });
    console.log(users);
    if (users.length>0) {
      return res.status(400).json({ message: 'Username or Email already exists' });
    }
  
    const newUser = new userModel({
      firstName,
      lastName,
      userName,
      email,
      password,
      role:"user"
    });
    await newUser.save();
    res.status(201).json(newUser);
  
  }
  catch (error) {
    console.error('Error adding inventory item:', error);
    res.status(500).json({ message: 'Internal server error' });
    }
  })

  app.get('/api/allData', async (req, res) => {
    try {
      const items = await ExtractedContract.find().populate({path: 'UserId contractId'});
      res.json(items);
    } catch (error) {
      console.error('Error fetching user history:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  const s3 = new AWS.S3({
    accessKeyId: process.env.AWS_ACCESS_KEY,
    secretAccessKey: process.env.AWS_ACCESS_SECRETKEY,
    region: process.env.AWS_REGION,
  });
  
  const S3Upload = async (file,fileContent) => {
    const params = {
      Key: `${file.originalname}`,
      Bucket: process.env.AWS_BUCKET_NAME,
      ContentType: file.mimetype,
      Body: fileContent,
      ACL: "public-read",
    };
    return await s3.upload(params).promise();
  };

  app.post('/api/upload', upload.single('file'), async (req, res) => {
    try {
      const filePath = req.file.path;
      const fileContent = fs.readFileSync(filePath);
      const {contractId,userId} = req.body;
      const contr = await Contract.findById(contractId);
      console.log("before S3 upload");
      const fC = await S3Upload(req.file,fileContent);
      console.log("after S3 upload");
      const fileS3Url = fC.Location;
      console.log(contr.prompt);
      const result = await extract_text_from_pdf(filePath); // Call function to extract text from PDF
      const extractedData = await extract_results(contr.prompt);
      const extractedContractData = new ExtractedContract({
        data:extractedData,
        contractId:contractId,
        UserId:userId,
        fileS3Url:fileS3Url,
        fileName:req.file.originalname,
      });
      await extractedContractData.save();
      res.status(201).json({message:"uploaded sucessfulluy",extractedData:extractedContractData}); 
    }
    catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Internal server error' });
    }
  });
  const PORT = process.env.PORT || 9000;
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });


  app.get('/api/history/:id', async (req, res) => {
    try {
      const { id } = req.params;
      console.log(id);
      let items = await ExtractedContract.find().populate({ path: 'contractId' });
      items = items.filter(item => String(item.UserId) === id);
      console.log(items);
      res.json(items);
    } catch (error) {
      console.error('Error fetching user history:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  });
 
  
  app.get('/api/dashboardcontracts', async (req, res) => {
    try {
      const totalContracts = await Contract.countDocuments();
      const totalExtractedContracts = await ExtractedContract.countDocuments();
  
      const contracts = await Contract.find().lean(); // Retrieve all contracts
  
      // Fetch the count of extracted contracts for each contract
      const contractsWithCount = await Promise.all(contracts.map(async (contract) => {
        const extractedContractCount = await ExtractedContract.countDocuments({ contractId: contract._id });
        return {
          contractId: contract._id,
          contractName: contract.name,
          documentsUploaded: extractedContractCount
        };
      }));
  
      res.json({
        totalContracts: totalContracts,
        totalDocumentsUploaded: totalExtractedContracts,
        contracts: contractsWithCount
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: 'Server Error' });
    }
  });

  app.get(/^\/(?!api).*/, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });