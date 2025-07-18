#!/usr/bin/env python3

import subprocess
import sys
import os
import time

def run_command(cmd, description):
    """Run a command and handle errors"""
    print(f"\n🔄 {description}")
    print(f"Command: {cmd}")
    try:
        result = subprocess.run(cmd, shell=True, check=True, cwd="/home/nut/loyalty-app", 
                              capture_output=True, text=True)
        if result.stdout:
            print("Output:", result.stdout)
        return True
    except subprocess.CalledProcessError as e:
        print(f"❌ Error: {e}")
        if e.stdout:
            print("Stdout:", e.stdout)
        if e.stderr:
            print("Stderr:", e.stderr)
        return False

def main():
    print("🔄 Rebuilding and restarting user service...")
    print("============================================")
    
    # Change to the correct directory
    os.chdir("/home/nut/loyalty-app")
    
    commands = [
        ("docker-compose stop user-service", "Stopping user service"),
        ("docker-compose rm -f user-service", "Removing existing container"),
        ("docker-compose build user-service", "Building new user service image"),
        ("docker-compose up -d user-service", "Starting user service"),
    ]
    
    # Execute commands
    for cmd, desc in commands:
        if not run_command(cmd, desc):
            print(f"❌ Failed to {desc.lower()}")
            sys.exit(1)
    
    # Wait for service to start
    print("\n⏳ Waiting for service to start...")
    time.sleep(3)
    
    # Check service status
    print("\n📊 Service status:")
    run_command("docker-compose ps user-service", "Checking service status")
    
    # Show recent logs
    print("\n📋 Recent logs:")
    run_command("docker-compose logs --tail=10 user-service", "Showing recent logs")
    
    print("\n✅ User service rebuild complete!")

if __name__ == "__main__":
    main()