-- Cars (ADR-049): driver and operator-agent roles, and the bus, ride and rental verticals.
-- AlterEnum
ALTER TYPE "RoleKey" ADD VALUE 'driver';
ALTER TYPE "RoleKey" ADD VALUE 'operator_agent';

-- AlterEnum
ALTER TYPE "Vertical" ADD VALUE 'buses';
ALTER TYPE "Vertical" ADD VALUE 'rides';
ALTER TYPE "Vertical" ADD VALUE 'rentals';
