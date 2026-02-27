# DDD Weather Discount Challenge - Environment Setup
FROM mcr.microsoft.com/dotnet/sdk:8.0

# Install essential tools
RUN apt-get update && apt-get install -y \
    git \
    curl \
    wget \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /workspace

# Clone the DDD-starter-dotnet repository
RUN git clone https://github.com/itlibrium/DDD-starter-dotnet.git project

# Set working directory to the project
WORKDIR /workspace/project

# Restore dependencies and perform initial build
# This ensures all NuGet packages are downloaded and the project is buildable
RUN dotnet restore MyCompany.ECommerce.sln
RUN dotnet build MyCompany.ECommerce.sln --configuration Debug --no-restore

# Verify build succeeded
RUN echo "Build verification completed successfully"

# Set the working directory for the agent
WORKDIR /workspace/project

# Default command
CMD ["/bin/bash"]
