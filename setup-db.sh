#!/bin/bash

# Database setup script for FMS
# Run this after npm install to set up the database

echo "🚀 Setting up FMS Database System..."
echo ""

# Create database directory if it doesn't exist
mkdir -p ./data

echo "✓ Created database directory: ./data"
echo ""

# Database file will be created automatically when the server starts
echo "📊 Database will be initialized automatically when the server starts."
echo ""

# Optional: Create symbolic link for easier backup
# ln -s ./data/fms.db ./fms-backup.db 2>/dev/null || true

echo "✅ Database setup complete!"
echo ""
echo "Next steps:"
echo "1. Run 'npm install' to install dependencies (including better-sqlite3)"
echo "2. Run 'npm run dev' to start the server"
echo "3. The database will be automatically initialized with seed data"
echo ""
echo "Database file location: ./data/fms.db"
echo "Backup your database regularly!"
