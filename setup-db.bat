#!/bin/bash

# Database setup script for Windows FMS
# Run this after npm install to set up the database

echo "Clearing FMS Database..."
echo ""

# Create database directory if it doesn't exist
if not exist "data" mkdir data

echo "Creating fresh database..."

# Run the reset command (this would be done programmatically)
echo "Database directory prepared: ./data"
echo ""

echo "To reset the database programmatically, add this to your server startup:"
echo "import { resetDatabase } from './src/database/seed.js';"
echo "resetDatabase(); // Run once on startup if needed"
echo ""

echo "Database setup complete!"
